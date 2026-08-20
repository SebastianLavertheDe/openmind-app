/**
 * Anonymous openmind fixture builder — Phase 0 deliverable #11.
 *
 * Produces a deterministic, anonymised `openmind` directory tree under a temp
 * dir, for use by path/resolver/migration tests. Per the plan (§19.2) it
 * exercises: current top-level dirs, Chinese creative stage dirs, date dirs,
 * hidden dirs, user-unknown dirs, empty dirs, many files, symlink/junction,
 * read-only file, CJK/space/emoji/long names, and a damaged/partial layout.
 *
 * The builder never touches the real openmind tree; it creates everything
 * fresh. Callers own the returned root and must `rmSync(root, recursive)`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BuiltFixture {
  readonly root: string;
  /** A directory outside `root`, used as a symlink target for escape tests. */
  readonly outside: string;
}

export function buildAnonymousOpenmindFixture(prefix = "openmind-fixture-"): BuiltFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), prefix + "outside-"));
  try {
    buildInto(root, outside);
    return { root, outside };
  } catch (e) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    throw e;
  }
}

function buildInto(root: string, outside: string): void {
  const join = (...p: string[]) => path.join(root, ...p);
  const w = (rel: string, content: string) => {
    const full = join(...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  // --- current top-level content dirs (per ADR-002 audit) ---
  w("article/20260805/01_example.md", "# 匿名文章示例\n\n正文内容。\n");
  w("article/20260805/02_another.md", "# Another anonymised article\n");
  w("article/20260804/old.md", "# older\n");

  // Chinese creative stage dirs — names MUST round-trip verbatim.
  w(
    "creative/01-内容生产/文稿库/02-制作中/example-pkg/draft.md",
    "# 草稿\n"
  );
  w(
    "creative/01-内容生产/选题管理/00-兴趣收集箱.md",
    "# 兴趣收集箱\n\n- [i] 某兴趣标记\n"
  );
  w(
    "creative/01-内容生产/选题管理/ai_topic_2026-08-05.md",
    "# AI 选题\n"
  );

  w("daily-summary/20260805_daily_summary.md", "# 日报\n");
  w("daily-topic/20260805_daily_topic.md", "# 选题\n");
  w("post/20260805/index.html", "<html></html>");
  w("post/20260805/posts.json", "[]");
  w("reddit/20260805/sub.md", "# subreddit\n");
  w("wiki/index.md", "# Wiki\n");

  // --- optional / tool-private (preserved verbatim, never created by app) ---
  fs.mkdirSync(join(".claude"), { recursive: true });
  fs.writeFileSync(join(".claude", "settings.local.json"), "{}");

  // --- user-unknown dir (must NOT be deleted/moved by app) ---
  w("my-custom-notes/note.md", "# personal\n");

  // --- empty dir ---
  fs.mkdirSync(join("article", "empty-day"), { recursive: true });

  // --- many files (volume smoke) ---
  const many = join("article", "20260801");
  fs.mkdirSync(many, { recursive: true });
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(many, `f${i}.md`), `# file ${i}\n`);
  }

  // --- CJK / space / emoji / long names ---
  // Note: the single path *component* length is capped to stay under the
  // POSIX NAME_MAX (255 bytes); a full long-**path** test (depth) is handled
  // separately. 70 × 3-byte CJK chars = 210 bytes + ".md" = within limit.
  w("article/20260805/中文 文件名 🎉.md", "# CJK space emoji\n");
  const longName = "长".repeat(70) + ".md";
  w(`article/20260805/${longName}`, "# long name\n");

  // --- read-only file ---
  const ro = join("article", "20260805", "readonly.md");
  fs.writeFileSync(ro, "# readonly\n");
  try {
    fs.chmodSync(ro, 0o444);
  } catch {
    // chmod may be a no-op on some filesystems; not fatal for the fixture.
  }

  // --- symlink that stays inside the root (must be allowed) ---
  const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(
    path.join(root, "article", "20260805"),
    path.join(root, "article", "20260805-link"),
    directoryLinkType
  );

  // --- symlink that escapes the root (must be REJECTED by resolver) ---
  fs.symlinkSync(outside, path.join(root, "article", "escape-link"), directoryLinkType);

  // --- partial / damaged layout: missing `wiki/` would be flagged by health,
  //     but here we instead drop a stray non-md file in a content dir ---
  w("daily-summary/.partial", "partial");

  // --- a top-level dir NOT in the layout contract (write must be refused) ---
  w("invented-toplevel/x.md", "# not a contract dir\n");
}

/** Recursively remove a fixture built by {@link buildAnonymousOpenmindFixture}. */
export function disposeFixture(f: BuiltFixture): void {
  // Best-effort: reset read-only files before rm.
  try {
    const ro = path.join(f.root, "article", "20260805", "readonly.md");
    fs.chmodSync(ro, 0o644);
  } catch {
    // ignore
  }
  fs.rmSync(f.root, { recursive: true, force: true });
  fs.rmSync(f.outside, { recursive: true, force: true });
}
