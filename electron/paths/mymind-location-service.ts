import fs from "node:fs";
import path from "node:path";
import { detectPathConflicts, type AppPaths } from "./app-paths-service";
import {
  MYMIND_APP_MANAGED_TOP_LEVEL,
  MYMIND_CREATE_IF_NEEDED_TOP_LEVEL,
  MYMIND_LAYOUT_VERSION,
  MYMIND_OPTIONAL_TOP_LEVEL
} from "../../shared/mymind-layout-v2";
import { computeRootId, type MymindRootSnapshot } from "./mymind-path-resolver";

export type RootBinding = {
  rootId: string;
  activeLocation: string;
  historicalLocations: Array<{
    path: string;
    generation: number;
    appAccess: "read-only" | "unavailable";
  }>;
  generation: number;
  layoutVersion: typeof MYMIND_LAYOUT_VERSION;
};

export type MymindRootHealth = {
  configured: boolean;
  rootId?: string;
  accessible: boolean;
  readable: boolean;
  writable: boolean;
  expectedStructureVersion?: typeof MYMIND_LAYOUT_VERSION;
  missingInitializeEntries: string[];
  missingCreateIfNeededEntries: string[];
  optionalObservedEntries: string[];
  unknownPreservedEntries: string[];
  symlinkWarnings: string[];
  activeRunCount: number;
  warnings: string[];
};

export type MymindLocationServiceOptions = {
  paths: AppPaths;
  activeRunCount?: () => number;
};

/**
 * Owns root inspection and immutable Run snapshots. It deliberately does not
 * move or create content: binding an existing root is a path operation only.
 */
export class MymindLocationService {
  private readonly activeRunCount: () => number;

  constructor(private readonly options: MymindLocationServiceOptions) {
    this.activeRunCount = options.activeRunCount ?? (() => 0);
  }

  inspect(candidate?: string): MymindRootHealth {
    const raw = String(candidate || "").trim();
    if (!raw) return emptyHealth(this.activeRunCount());
    let root: string;
    try { root = fs.realpathSync(path.resolve(raw)); }
    catch { return { ...emptyHealth(this.activeRunCount()), configured: true, warnings: ["mymind 根目录不存在或无法解析。"] }; }

    let stat: fs.Stats;
    try { stat = fs.statSync(root); }
    catch { return { ...emptyHealth(this.activeRunCount()), configured: true, warnings: ["mymind 根目录不可访问。"] }; }
    if (!stat.isDirectory()) return { ...emptyHealth(this.activeRunCount()), configured: true, warnings: ["mymind 根路径不是目录。"] };

    const readable = canAccess(root, fs.constants.R_OK);
    const writable = canAccess(root, fs.constants.W_OK);
    const observed = safeDirectoryEntries(root);
    const optionalObservedEntries = MYMIND_OPTIONAL_TOP_LEVEL.filter((name) => observed.has(name));
    const known = new Set([...MYMIND_CREATE_IF_NEEDED_TOP_LEVEL, ...MYMIND_OPTIONAL_TOP_LEVEL, ...MYMIND_APP_MANAGED_TOP_LEVEL]);
    const unknownPreservedEntries = [...observed].filter((name) => !known.has(name)).sort();
    const missingCreateIfNeededEntries = MYMIND_CREATE_IF_NEEDED_TOP_LEVEL.filter((name) => !observed.has(name));
    const conflicts = detectPathConflicts(this.options.paths, root);
    const warnings = [...conflicts.map((conflict) => `路径冲突：${conflict.kind}`)];
    if (!readable) warnings.push("mymind 根目录不可读。");
    if (!writable) warnings.push("mymind 根目录不可写。");
    return {
      configured: true,
      rootId: computeRootId(root),
      accessible: true,
      readable,
      writable,
      expectedStructureVersion: MYMIND_LAYOUT_VERSION,
      missingInitializeEntries: [],
      missingCreateIfNeededEntries,
      optionalObservedEntries,
      unknownPreservedEntries,
      symlinkWarnings: [],
      activeRunCount: this.activeRunCount(),
      warnings
    };
  }

  bind(candidate: string, current?: RootBinding): RootBinding {
    const root = canonicalDirectory(candidate);
    if (!root) throw new Error("无法绑定不存在或不可访问的 mymind 根目录。");
    const health = this.inspect(root);
    if (!health.readable || !health.writable || health.warnings.some((warning) => warning.startsWith("路径冲突"))) {
      throw new Error(health.warnings.join("；") || "mymind 根目录不可用。");
    }
    if (this.activeRunCount() > 0) throw new Error("有运行中的任务，暂时不能切换 mymind 根目录。");
    const sameRoot = current?.activeLocation === root;
    return {
      rootId: current?.rootId || computeRootId(root),
      activeLocation: root,
      historicalLocations: current?.historicalLocations || [],
      generation: sameRoot ? current!.generation : (current?.generation || 0) + 1,
      layoutVersion: MYMIND_LAYOUT_VERSION
    };
  }

  snapshot(binding: RootBinding): MymindRootSnapshot {
    return {
      rootPath: binding.activeLocation,
      rootId: binding.rootId,
      rootGeneration: binding.generation
    };
  }
}

function emptyHealth(activeRunCount: number): MymindRootHealth {
  return {
    configured: false,
    accessible: false,
    readable: false,
    writable: false,
    missingInitializeEntries: [],
    missingCreateIfNeededEntries: [],
    optionalObservedEntries: [],
    unknownPreservedEntries: [],
    symlinkWarnings: [],
    activeRunCount,
    warnings: []
  };
}

function canonicalDirectory(candidate: string): string | null {
  try {
    const root = fs.realpathSync(path.resolve(candidate));
    return fs.statSync(root).isDirectory() ? root : null;
  } catch { return null; }
}

function canAccess(root: string, mode: number): boolean {
  try { fs.accessSync(root, mode); return true; }
  catch { return false; }
}

function safeDirectoryEntries(root: string): Set<string> {
  try { return new Set(fs.readdirSync(root)); }
  catch { return new Set(); }
}
