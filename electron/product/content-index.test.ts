import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomic } from "../lib/fs-utils";
import { ContentIndexStore } from "./content-index";
import { createExplicitContentSource } from "./content-source";
import type { ContentApi } from "./common";

// 冷搜索批量落盘的回归门禁：写盘次数必须与 sweep 次数（1 次）一致，
// 与变化日期数无关。此前每个变化日期都会把不断增大的完整索引原子写一次。
vi.mock("../lib/fs-utils", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeJsonAtomic: vi.fn()
}));

const writeJsonAtomicMock = vi.mocked(writeJsonAtomic);

const DATE_COUNT = 60;
const FILES_PER_DATE = 10;
const DOC_BODY = "正文内容用于撑起 searchText 体积。".repeat(300);

describe("ContentIndexStore 批量落盘", () => {
  let root = "";
  let stateRoot = "";
  let entriesByDate: Map<string, Array<{ path: string; name: string; kind: string; size: number; modifiedAt: string }>>;
  let contentByPath: Map<string, string>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-index-"));
    stateRoot = path.join(root, "state");
    writeJsonAtomicMock.mockClear();
    entriesByDate = new Map();
    contentByPath = new Map();
    for (let index = 0; index < DATE_COUNT; index += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10).replaceAll("-", "");
      fs.mkdirSync(path.join(root, "article", date), { recursive: true });
      entriesByDate.set(date, Array.from({ length: FILES_PER_DATE }, (_, file) => {
        const relativePath = `article/${date}/doc-${file}.md`;
        contentByPath.set(relativePath, `# 标题 ${date} ${file}\n\n来源: TestSuite\n\n${DOC_BODY} needle-${index}-${file}`);
        return {
          path: relativePath,
          name: `doc-${file}.md`,
          kind: "articles",
          size: 8192,
          modifiedAt: `2026-01-${String(1 + (index % 28)).padStart(2, "0")}T10:00:00.000Z`
        };
      }));
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function createStore(): ContentIndexStore {
    const api: ContentApi = {
      getContent: (_kind: string, date: string) => entriesByDate.get(date) || [],
      readContent: (relativePath: string) => ({
        path: relativePath,
        name: path.basename(relativePath),
        content: contentByPath.get(relativePath) || "",
        truncated: false
      })
    };
    return new ContentIndexStore(root, api, stateRoot);
  }

  function writtenPayloads(): Array<Record<string, unknown>> {
    return writeJsonAtomicMock.mock.calls.map((call) => call[1] as Record<string, unknown>);
  }

  it("冷搜索整轮 sweep 只落盘一次，且写出完整索引", () => {
    const store = createStore();
    const startedAt = performance.now();
    const results = store.searchContent("needle-0-1", 24);
    const elapsedMs = performance.now() - startedAt;

    expect(results.some((result) => result.targetId)).toBe(true);
    expect(writeJsonAtomicMock).toHaveBeenCalledTimes(1);
    const payload = writtenPayloads()[0];
    const items = payload.items as Record<string, unknown>;
    expect(Object.keys(items)).toHaveLength(DATE_COUNT * FILES_PER_DATE);

    // 写放大回归门禁：累计落盘字节不允许超过最终索引体积的 2 倍。
    const finalBytes = JSON.stringify(payload).length;
    const cumulativeBytes = writtenPayloads().reduce((sum, value) => sum + JSON.stringify(value).length, 0);
    expect(cumulativeBytes).toBeLessThanOrEqual(finalBytes * 2);
    // 冷搜索耗时预算（宽松）：此前 1200 文件冷搜索约 2.6s，修复后应远低于该量级。
    expect(elapsedMs).toBeLessThan(1_500);
  });

  it("热搜索（TTL 内）零落盘", () => {
    const store = createStore();
    store.searchContent("needle-0-1", 24);
    expect(writeJsonAtomicMock).toHaveBeenCalledTimes(1);
    store.searchContent("needle-2-3", 24);
    store.searchContent("不存在的查询词", 24);
    expect(writeJsonAtomicMock).toHaveBeenCalledTimes(1);
  });

  it("命中 limit 提前返回时同样落盘已重建的日期", () => {
    const store = createStore();
    const results = store.searchContent("needle", 1);
    expect(results).toHaveLength(1);
    expect(writeJsonAtomicMock).toHaveBeenCalledTimes(1);
    const items = writtenPayloads()[0].items as Record<string, unknown>;
    // 日期按新到旧扫，首个日期命中 limit 后立即返回：只有该日期进入本轮落盘。
    expect(Object.keys(items)).toHaveLength(FILES_PER_DATE);
  });

  it("refreshDate（保存后单天刷新）保持立即落盘一次", () => {
    const store = createStore();
    store.searchContent("needle-0-1", 24);
    expect(writeJsonAtomicMock).toHaveBeenCalledTimes(1);

    const date = [...entriesByDate.keys()][0];
    const extraPath = `article/${date}/doc-extra.md`;
    entriesByDate.get(date)!.push({
      path: extraPath,
      name: "doc-extra.md",
      kind: "articles",
      size: 1024,
      modifiedAt: "2026-01-01T11:00:00.000Z"
    });
    contentByPath.set(extraPath, `# 新增文档\n\n来源: TestSuite\n\nrefreshDate 追加内容`);

    store.refreshDate(date);
    expect(writeJsonAtomicMock).toHaveBeenCalledTimes(2);
    const items = writtenPayloads()[1].items as Record<string, { date: string }>;
    expect(items[extraPath]?.date).toBe(date);
    expect(Object.values(items).filter((item) => item.date === date)).toHaveLength(FILES_PER_DATE + 1);
  });
});

describe("ContentIndexStore 冷建实测（1200 文件真实 fs）", () => {
  // 原 P1 基准口径：120 日期 × 10 文件。用真实文件 + 显式 root 内容源测量
  // 修复后仍留在引擎里的同步成本（readdir/readFileSync/Zod/searchText；落盘
  // mock 保留，单次原子写成本另计），为 worker 化提供前后对照；worker 化后
  // 该成本整体离开主进程。
  const COLD_DATE_COUNT = 120;
  const COLD_FILES_PER_DATE = 10;
  const coldRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-cold-"));
  const coldStateRoot = path.join(coldRoot, "state");

  beforeAll(() => {
    for (let index = 0; index < COLD_DATE_COUNT; index += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10).replaceAll("-", "");
      for (let file = 0; file < COLD_FILES_PER_DATE; file += 1) {
        const dir = path.join(coldRoot, "article", date);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `doc-${file}.md`), `# 标题 ${date} ${file}\n\n来源: ColdBench\n\n${"正文内容用于撑起 searchText 体积。".repeat(60)} needle-${index}-${file}`);
      }
    }
  });

  afterAll(() => {
    fs.rmSync(coldRoot, { recursive: true, force: true });
  });

  it("完整冷建 + 启动装载的量级受控", () => {
    const startedAt = performance.now();
    const coldStore = new ContentIndexStore(coldRoot, createExplicitContentSource(coldRoot), coldStateRoot);
    const coldResults = coldStore.searchContent("needle-0-1", 24);
    const coldMs = performance.now() - startedAt;
    expect(coldResults.length).toBeGreaterThan(0);

    const loadStartedAt = performance.now();
    const warmStore = new ContentIndexStore(coldRoot, createExplicitContentSource(coldRoot), coldStateRoot);
    const loadResults = warmStore.searchContent("needle-59-2", 24);
    const loadMs = performance.now() - loadStartedAt;
    expect(loadResults.length).toBeGreaterThan(0);

    console.info(`[cold-build bench] 1200 文件完整冷建 ${coldMs.toFixed(0)}ms；启动索引装载+重扫 ${loadMs.toFixed(0)}ms`);
    // 数值为信息性记录（全量并行负载下时间断言会抖动，参考隔离运行 ~200-330ms）；
    // 回归门禁由写盘次数断言、奇偶校验与 worker 传输测试承担。
  });
});
