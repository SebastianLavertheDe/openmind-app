import fs from "node:fs";
import path from "node:path";
import { detectPathConflicts, type AppPaths } from "./app-paths-service";
import {
  OPENMIND_V4_APP_MANAGED_TOP_LEVEL as OPENMIND_APP_MANAGED_TOP_LEVEL,
  OPENMIND_V4_CREATE_IF_NEEDED_TOP_LEVEL as OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL,
  OPENMIND_LAYOUT_VERSION_V4 as OPENMIND_LAYOUT_VERSION,
  OPENMIND_V4_OPTIONAL_TOP_LEVEL as OPENMIND_OPTIONAL_TOP_LEVEL
} from "../../shared/openmind-layout-v4";
import { computeRootId, type OpenmindRootSnapshot } from "./openmind-path-resolver";

export type RootBinding = {
  rootId: string;
  activeLocation: string;
  historicalLocations: Array<{
    path: string;
    generation: number;
    appAccess: "read-only" | "unavailable";
  }>;
  generation: number;
  layoutVersion: typeof OPENMIND_LAYOUT_VERSION;
};

export type OpenmindRootHealth = {
  configured: boolean;
  rootId?: string;
  accessible: boolean;
  readable: boolean;
  writable: boolean;
  expectedStructureVersion?: typeof OPENMIND_LAYOUT_VERSION;
  missingInitializeEntries: string[];
  missingCreateIfNeededEntries: string[];
  optionalObservedEntries: string[];
  unknownPreservedEntries: string[];
  symlinkWarnings: string[];
  activeRunCount: number;
  warnings: string[];
};

export type OpenmindLocationServiceOptions = {
  paths: AppPaths;
  activeRunCount?: () => number;
};

/**
 * Owns root inspection and immutable Run snapshots. It deliberately does not
 * move or create content: binding an existing root is a path operation only.
 */
export class OpenmindLocationService {
  private readonly activeRunCount: () => number;

  constructor(private readonly options: OpenmindLocationServiceOptions) {
    this.activeRunCount = options.activeRunCount ?? (() => 0);
  }

  inspect(candidate?: string): OpenmindRootHealth {
    const raw = String(candidate || "").trim();
    if (!raw) return emptyHealth(this.activeRunCount());
    let root: string;
    try { root = fs.realpathSync(path.resolve(raw)); }
    catch { return { ...emptyHealth(this.activeRunCount()), configured: true, warnings: ["openmind 根目录不存在或无法解析。"] }; }

    let stat: fs.Stats;
    try { stat = fs.statSync(root); }
    catch { return { ...emptyHealth(this.activeRunCount()), configured: true, warnings: ["openmind 根目录不可访问。"] }; }
    if (!stat.isDirectory()) return { ...emptyHealth(this.activeRunCount()), configured: true, warnings: ["openmind 根路径不是目录。"] };

    const readable = canAccess(root, fs.constants.R_OK);
    const writable = canAccess(root, fs.constants.W_OK);
    const observed = safeDirectoryEntries(root);
    const optionalObservedEntries = OPENMIND_OPTIONAL_TOP_LEVEL.filter((name) => observed.has(name));
    const known = new Set([...OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL, ...OPENMIND_OPTIONAL_TOP_LEVEL, ...OPENMIND_APP_MANAGED_TOP_LEVEL]);
    const unknownPreservedEntries = [...observed].filter((name) => !known.has(name)).sort();
    const missingCreateIfNeededEntries = OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL.filter((name) => !observed.has(name));
    const conflicts = detectPathConflicts(this.options.paths, root);
    const warnings = [...conflicts.map((conflict) => `路径冲突：${conflict.kind}`)];
    if (!readable) warnings.push("openmind 根目录不可读。");
    if (!writable) warnings.push("openmind 根目录不可写。");
    return {
      configured: true,
      rootId: computeRootId(root),
      accessible: true,
      readable,
      writable,
      expectedStructureVersion: OPENMIND_LAYOUT_VERSION,
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
    if (!root) throw new Error("无法绑定不存在或不可访问的 openmind 根目录。");
    const health = this.inspect(root);
    if (!health.readable || !health.writable || health.warnings.some((warning) => warning.startsWith("路径冲突"))) {
      throw new Error(health.warnings.join("；") || "openmind 根目录不可用。");
    }
    if (this.activeRunCount() > 0) throw new Error("有运行中的任务，暂时不能切换 openmind 根目录。");
    const sameRoot = current?.activeLocation === root;
    return {
      rootId: current?.rootId || computeRootId(root),
      activeLocation: root,
      historicalLocations: current?.historicalLocations || [],
      generation: sameRoot ? current!.generation : (current?.generation || 0) + 1,
      layoutVersion: OPENMIND_LAYOUT_VERSION
    };
  }

  snapshot(binding: RootBinding): OpenmindRootSnapshot {
    return {
      rootPath: binding.activeLocation,
      rootId: binding.rootId,
      rootGeneration: binding.generation
    };
  }
}

function emptyHealth(activeRunCount: number): OpenmindRootHealth {
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
