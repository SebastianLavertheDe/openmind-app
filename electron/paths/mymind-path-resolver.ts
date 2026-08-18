/**
 * MymindPathResolver — maps logical mymind paths to a single physical
 * `mymindRoot`, with traversal/symlink protection.
 *
 * Frozen by ADR-001 (§5.2) + ADR-002 (layout contract). App, CLI Agent hosts,
 * and App-native Workflow file operations MUST go through this resolver.
 *
 * Resolution rules (ADR-001 §5.2):
 *   1. accept logical path with or without a single leading `mymind/`;
 *   2. normalise separators to `/`;
 *   3. reject absolute paths, UNC, drive-prefixed;
 *   4. reject empty segments, `.`, `..`, encoded traversal;
 *   5. join onto the pinned `mymindRootSnapshot`;
 *   6. realpath-check existing parents;
 *   7. reject symlinks/junctions that leave the root;
 *   8. Windows: case-insensitive compare;
 *   9. WSL/UNC: separate normalisation (handled at bind time);
 *  10. return both physical path and a logical path for UI/logs;
 *  11. write patterns re-checked against {@link MYMIND_ALLOWED_TOP_LEVEL_DIRS}.
 *
 * IMPORTANT: this enforces the layout for app-controlled code only.
 * Process/External Agent skills run with the user's OS privileges and CAN
 * bypass this resolver; the product does not claim otherwise (ADR-004).
 */

import fs from "node:fs";
import path from "node:path";
import {
  MYMIND_LAYOUT_VERSION,
  MYMIND_WRITABLE_TOP_LEVEL_DIRS,
  topLevelOf
} from "../../shared/mymind-layout-v2";

export interface MymindRootSnapshot {
  /** Canonical real path of the mymind root. */
  readonly rootPath: string;
  /** Stable root id. */
  readonly rootId: string;
  /** Monotonic generation; bumped on switch/relocate. */
  readonly rootGeneration: number;
}

export interface ResolvedMymindPath {
  /** Canonical physical path inside the root. */
  readonly physicalPath: string;
  /** Logical path (forward-slash, no leading `mymind/`) for UI/logs. */
  readonly logicalPath: string;
  /** The snapshot this was resolved against. */
  readonly snapshot: MymindRootSnapshot;
}

export class MymindPathError extends Error {
  constructor(
    public readonly code: MymindPathErrorCode,
    message: string,
    public readonly logicalPath?: string
  ) {
    super(message);
    this.name = "MymindPathError";
  }
}

export type MymindPathErrorCode =
  | "absolute-path-forbidden"
  | "unc-path-forbidden"
  | "drive-path-forbidden"
  | "empty-segment"
  | "dot-segment-forbidden"
  | "parent-segment-forbidden"
  | "traversal-detected"
  | "not-inside-root"
  | "symlink-escapes-root"
  | "unknown-top-level-write";

export interface ResolverOptions {
  /**
   * Whether the filesystem is case-sensitive. Default: platform-derived
   * (false on win32/darwin, true otherwise). Tests override explicitly.
   */
  readonly caseSensitive?: boolean;
}

export class MymindPathResolver {
  private readonly caseSensitive: boolean;

  constructor(
    private readonly snapshot: MymindRootSnapshot,
    opts: ResolverOptions = {}
  ) {
    this.caseSensitive =
      opts.caseSensitive ??
      (process.platform !== "win32" && process.platform !== "darwin");
  }

  /** The pinned snapshot this resolver resolves against. */
  getRoot(): MymindRootSnapshot {
    return this.snapshot;
  }

  /**
   * Resolve a logical mymind path to a physical path. Validates syntax and,
   * for paths whose parent exists, validates that the resolved real path
   * remains inside the root.
   *
   * @param mode "read" performs realpath check on existing parents only;
   *             "write" additionally requires the top-level dir to be a
   *             known content-contract entry (ADR-002).
   */
  resolve(logicalInput: string, mode: "read" | "write" = "read"): ResolvedMymindPath {
    const normalised = this.normaliseLogical(logicalInput);
    if (mode === "write") this.assertWriteAllowed(normalised);
    const physical = path.join(this.snapshot.rootPath, normalised);
    this.assertInsideRoot(physical);
    this.assertNoEscapingSymlink(physical);
    return {
      physicalPath: physical,
      logicalPath: normalised,
      snapshot: this.snapshot
    };
  }

  // --- internal -------------------------------------------------------------

  /** Strip a single leading `mymind/`, normalise separators, reject bad input. */
  private normaliseLogical(input: string): string {
    if (typeof input !== "string" || input.length === 0) {
      throw new MymindPathError("empty-segment", "empty logical path", input);
    }
    let p = input.trim();
    // Backslash → forward slash (Windows user input).
    p = p.replaceAll("\\", "/");
    // Reject absolute forms before any normalisation that might mask them.
    if (p.startsWith("//")) throw new MymindPathError("unc-path-forbidden", "UNC paths are forbidden", input);
    if (p.startsWith("/")) throw new MymindPathError("absolute-path-forbidden", "absolute paths are forbidden", input);
    if (/^[a-zA-Z]:\//.test(p)) throw new MymindPathError("drive-path-forbidden", "drive-prefixed paths are forbidden", input);
    // Strip a single leading `mymind/` only.
    if (p === "mymind" || p === "mymind/") return "";
    if (p.startsWith("mymind/")) p = p.slice("mymind/".length);
    // Collapse `./` and repeated slashes; reject `..`, `.`, empty segments.
    const segments = p.split("/").filter((seg) => seg.length > 0);
    for (const seg of segments) {
      if (seg === ".") throw new MymindPathError("dot-segment-forbidden", "'.' segments are forbidden", input);
      if (seg === "..") throw new MymindPathError("parent-segment-forbidden", "'..' segments are forbidden", input);
      // Reject percent-encoded traversal like %2e%2e or %2f.
      const decoded = tryDecodeSegment(seg);
      if (decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")) {
        throw new MymindPathError("traversal-detected", "encoded traversal detected", input);
      }
    }
    return segments.join("/");
  }

  private assertWriteAllowed(normalisedLogical: string): void {
    const top = topLevelOf(normalisedLogical);
    if (top === null) return; // writing to the root itself is not a new top-level
    if (!MYMIND_WRITABLE_TOP_LEVEL_DIRS.has(top)) {
      throw new MymindPathError(
        "unknown-top-level-write",
        `refusing to write to non-writable top-level '${top}'; ${MYMIND_LAYOUT_VERSION} only allows content-contract top-level directories`,
        normalisedLogical
      );
    }
  }

  private assertInsideRoot(physical: string): void {
    const rel = path.relative(this.snapshot.rootPath, physical);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new MymindPathError("not-inside-root", "resolved path is outside mymind root", physical);
    }
    if (!this.caseSensitive) {
      // Case-insensitive prefix check (Windows/macOS default).
      const rootLower = this.snapshot.rootPath.toLowerCase();
      const physLower = physical.toLowerCase();
      if (!physLower.startsWith(rootLower)) {
        throw new MymindPathError("not-inside-root", "resolved path is outside mymind root (case mismatch)", physical);
      }
    }
  }

  /**
   * Realpath-check the deepest existing ancestor of `physical`, and ensure
   * no symlink in the chain escapes the root. Non-existing leaves are fine
   * (they will be created by the writer).
   */
  private assertNoEscapingSymlink(physical: string): void {
    // Walk from the root down to the target, realpath-ing each existing
    // component. If a component is a symlink, ensure its realpath stays
    // inside the root.
    const rel = path.relative(this.snapshot.rootPath, physical);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      // already covered by assertInsideRoot; defensive double-check.
      throw new MymindPathError("not-inside-root", "path outside root", physical);
    }
    const segments = rel.split(path.sep).filter((s) => s.length > 0);
    let current = this.snapshot.rootPath;
    for (const seg of segments) {
      current = path.join(current, seg);
      try {
        const st = fs.lstatSync(current);
        if (st.isSymbolicLink()) {
          let real: string;
          try {
            real = fs.realpathSync(current);
          } catch {
            // Broken symlink; treat as escape (cannot resolve safely).
            throw new MymindPathError("symlink-escapes-root", "broken symlink in path", current);
          }
          const relReal = path.relative(this.snapshot.rootPath, real);
          if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
            throw new MymindPathError("symlink-escapes-root", "symlink points outside mymind root", current);
          }
        }
      } catch (e) {
        if (e instanceof MymindPathError) throw e;
        // ENOENT is fine: the leaf or an intermediate dir does not exist yet.
        // Any other error (EACCES, EIO) propagates.
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw e;
      }
    }
  }
}

function tryDecodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Compute a stable `rootId` from a canonical path (deterministic, does not
 * require a network or random source). Used when binding a new root.
 */
export function computeRootId(canonicalRootPath: string): string {
  // Simple deterministic fingerprint; collisions are acceptable because the
  // generation + historical location tuple disambiguates.
  let h = 0x811c9dc5;
  const s = canonicalRootPath;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // FNV-1a 32-bit, hex, 8 chars.
  return `root-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
