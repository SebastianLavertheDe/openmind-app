/**
 * OpenmindPathResolver — maps logical openmind paths to a single physical
 * `openmindRoot`, with traversal/symlink protection.
 *
 * Frozen by ADR-001 (§5.2) + ADR-002 (layout contract). App, CLI Agent hosts,
 * and App-native Workflow file operations MUST go through this resolver.
 *
 * Resolution rules (ADR-001 §5.2):
 *   1. accept logical path with or without a single leading `openmind/`;
 *   2. normalise separators to `/`;
 *   3. reject absolute paths, UNC, drive-prefixed;
 *   4. reject empty segments, `.`, `..`, encoded traversal;
 *   5. join onto the pinned `openmindRootSnapshot`;
 *   6. realpath-check existing parents;
 *   7. reject symlinks/junctions that leave the root;
 *   8. Windows: case-insensitive compare;
 *   9. WSL/UNC: separate normalisation (handled at bind time);
 *  10. return both physical path and a logical path for UI/logs;
 *  11. write patterns re-checked against {@link OPENMIND_ALLOWED_TOP_LEVEL_DIRS}.
 *
 * IMPORTANT: this enforces the layout for app-controlled code only.
 * Process/External Agent skills run with the user's OS privileges and CAN
 * bypass this resolver; the product does not claim otherwise (ADR-004).
 */

import fs from "node:fs";
import path from "node:path";
import {
  OPENMIND_LAYOUT_VERSION_V4 as OPENMIND_LAYOUT_VERSION,
  OPENMIND_V4_WRITABLE_TOP_LEVEL_DIRS as OPENMIND_WRITABLE_TOP_LEVEL_DIRS,
  topLevelOf
} from "../../shared/openmind-layout-v4";

export interface OpenmindRootSnapshot {
  /** Canonical real path of the openmind root. */
  readonly rootPath: string;
  /** Stable root id. */
  readonly rootId: string;
  /** Monotonic generation; bumped on switch/relocate. */
  readonly rootGeneration: number;
}

export interface ResolvedOpenmindPath {
  /** Canonical physical path inside the root. */
  readonly physicalPath: string;
  /** Logical path (forward-slash, no leading `openmind/`) for UI/logs. */
  readonly logicalPath: string;
  /** The snapshot this was resolved against. */
  readonly snapshot: OpenmindRootSnapshot;
}

export class OpenmindPathError extends Error {
  constructor(
    public readonly code: OpenmindPathErrorCode,
    message: string,
    public readonly logicalPath?: string
  ) {
    super(message);
    this.name = "OpenmindPathError";
  }
}

export type OpenmindPathErrorCode =
  | "absolute-path-forbidden"
  | "unc-path-forbidden"
  | "drive-path-forbidden"
  | "empty-segment"
  | "dot-segment-forbidden"
  | "parent-segment-forbidden"
  | "traversal-detected"
  | "not-inside-root"
  | "symlink-escapes-root"
  | "app-managed-project-forbidden"
  | "unknown-top-level-write";

export interface ResolverOptions {
  /**
   * Whether the filesystem is case-sensitive. Default: platform-derived
   * (false on win32/darwin, true otherwise). Tests override explicitly.
   */
  readonly caseSensitive?: boolean;
}

export class OpenmindPathResolver {
  constructor(
    private readonly snapshot: OpenmindRootSnapshot,
    _opts: ResolverOptions = {}
  ) {}

  /** The pinned snapshot this resolver resolves against. */
  getRoot(): OpenmindRootSnapshot {
    return this.snapshot;
  }

  /**
   * Resolve a logical openmind path to a physical path. Validates syntax and,
   * for paths whose parent exists, validates that the resolved real path
   * remains inside the root.
   *
   * @param mode "read" performs realpath check on existing parents only;
   *             "write" additionally requires the top-level dir to be a
   *             known content-contract entry (ADR-002).
   */
  resolve(logicalInput: string, mode: "read" | "write" = "read"): ResolvedOpenmindPath {
    const normalised = this.normaliseLogical(logicalInput);
    if (mode === "write" && topLevelOf(normalised) === "projects") {
      throw new OpenmindPathError(
        "app-managed-project-forbidden",
        "Project 内容只能通过 Project 专用接口访问。",
        normalised
      );
    }
    if (mode === "write") this.assertWriteAllowed(normalised);
    const physical = path.join(this.snapshot.rootPath, normalised);
    this.assertInsideRoot(physical);
    this.assertNoEscapingSymlink(physical);
    if (mode === "write") assertOutsideAppManagedProjects(this.snapshot.rootPath, physical, normalised);
    return {
      physicalPath: physical,
      logicalPath: normalised,
      snapshot: this.snapshot
    };
  }

  // --- internal -------------------------------------------------------------

  /** Strip a single leading `openmind/`, normalise separators, reject bad input. */
  private normaliseLogical(input: string): string {
    if (typeof input !== "string" || input.length === 0) {
      throw new OpenmindPathError("empty-segment", "empty logical path", input);
    }
    let p = input.trim();
    // Backslash → forward slash (Windows user input).
    p = p.replaceAll("\\", "/");
    // Reject absolute forms before any normalisation that might mask them.
    if (p.startsWith("//")) throw new OpenmindPathError("unc-path-forbidden", "UNC paths are forbidden", input);
    if (p.startsWith("/")) throw new OpenmindPathError("absolute-path-forbidden", "absolute paths are forbidden", input);
    if (/^[a-zA-Z]:\//.test(p)) throw new OpenmindPathError("drive-path-forbidden", "drive-prefixed paths are forbidden", input);
    // Strip a single leading `openmind/` only.
    if (p === "openmind" || p === "openmind/") return "";
    if (p.startsWith("openmind/")) p = p.slice("openmind/".length);
    // Collapse `./` and repeated slashes; reject `..`, `.`, empty segments.
    const segments = p.split("/").filter((seg) => seg.length > 0);
    for (const seg of segments) {
      if (seg === ".") throw new OpenmindPathError("dot-segment-forbidden", "'.' segments are forbidden", input);
      if (seg === "..") throw new OpenmindPathError("parent-segment-forbidden", "'..' segments are forbidden", input);
      // Reject percent-encoded traversal like %2e%2e or %2f.
      const decoded = tryDecodeSegment(seg);
      if (decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")) {
        throw new OpenmindPathError("traversal-detected", "encoded traversal detected", input);
      }
    }
    return segments.join("/");
  }

  private assertWriteAllowed(normalisedLogical: string): void {
    const top = topLevelOf(normalisedLogical);
    if (top === null) return; // writing to the root itself is not a new top-level
    if (!OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has(top)) {
      throw new OpenmindPathError(
        "unknown-top-level-write",
        `refusing to write to non-writable top-level '${top}'; ${OPENMIND_LAYOUT_VERSION} only allows content-contract top-level directories`,
        normalisedLogical
      );
    }
  }

  private assertInsideRoot(physical: string): void {
    if (!isCanonicalPathWithin(this.snapshot.rootPath, physical)) {
      throw new OpenmindPathError("not-inside-root", "resolved path is outside openmind root", physical);
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
      throw new OpenmindPathError("not-inside-root", "path outside root", physical);
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
            throw new OpenmindPathError("symlink-escapes-root", "broken symlink in path", current);
          }
          if (!isCanonicalPathWithin(this.snapshot.rootPath, real)) {
            throw new OpenmindPathError("symlink-escapes-root", "symlink points outside openmind root", current);
          }
        }
      } catch (e) {
        if (e instanceof OpenmindPathError) throw e;
        // ENOENT is fine: the leaf or an intermediate dir does not exist yet.
        // Any other error (EACCES, EIO) propagates.
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw e;
      }
    }
  }
}

/**
 * Generic workspace/content APIs must not cross into the app-managed
 * `projects/` tree.  Check both the lexical path and the canonical path so an
 * in-root symlink cannot be used as an alias for Project data.  ProjectService
 * deliberately uses ProjectPathResolver instead of this boundary.
 */
export function assertOutsideAppManagedProjects(
  openmindRootInput: string,
  candidateInput: string,
  logicalPath?: string
): void {
  const openmindRoot = path.resolve(openmindRootInput);
  const candidate = path.resolve(candidateInput);
  const projectsRoot = path.join(openmindRoot, "projects");
  if (isCanonicalPathWithin(projectsRoot, candidate)) {
    throw new OpenmindPathError(
      "app-managed-project-forbidden",
      "Project 内容只能通过 Project 专用接口访问。",
      logicalPath
    );
  }

  const canonicalCandidate = canonicalExistingOrProspective(candidate);
  const canonicalProjects = canonicalExistingOrProspective(projectsRoot);
  if (isCanonicalPathWithin(canonicalProjects, canonicalCandidate)) {
    throw new OpenmindPathError(
      "app-managed-project-forbidden",
      "Project 内容只能通过 Project 专用接口访问。",
      logicalPath
    );
  }
}

/**
 * Resolve an existing or prospective path below a trusted directory root.
 * The closest existing ancestor is realpathed so an in-root symlink cannot
 * redirect reads, opens, reveals, or a future write outside the selected
 * Workspace. Filesystem errors and broken symlinks fail closed.
 */
export function resolvePathInsideCanonicalRoot(
  rootInput: string,
  candidateInput: string,
  message = "路径超出所选 Workspace。"
): string {
  let root: string;
  let candidate: string;
  try {
    root = fs.realpathSync.native(path.resolve(rootInput));
    candidate = canonicalExistingOrProspective(candidateInput);
  } catch {
    throw new Error(message);
  }
  if (!isCanonicalPathWithin(root, candidate)) throw new Error(message);
  return candidate;
}

function canonicalExistingOrProspective(candidate: string): string {
  const tail: string[] = [];
  let cursor = path.resolve(candidate);
  while (true) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      tail.unshift(path.basename(cursor));
      cursor = parent;
      continue;
    }
    // lstat succeeded, so a realpath failure means a broken/unreadable link
    // or another filesystem error — never reinterpret it as a missing leaf.
    if (!stat) throw new Error("path unavailable");
    return path.resolve(fs.realpathSync.native(cursor), ...tail);
  }
}

export type CanonicalPathStyle = "native" | "posix" | "win32";

/**
 * Compare already-canonical paths component by component. Node's
 * `path.win32.relative()` deliberately folds case for every component, which
 * is unsafe for case-sensitive NTFS directories (`C:\\Root` and `C:\\root`
 * may be distinct). Only the Windows volume/UNC root identity is folded;
 * canonical directory and file components must match exactly.
 */
export function isCanonicalPathWithin(
  root: string,
  candidate: string,
  style: CanonicalPathStyle = "native"
): boolean {
  const flavor = style === "native"
    ? process.platform === "win32" ? "win32" : "posix"
    : style;
  const api = flavor === "win32" ? path.win32 : path.posix;
  const normalizedRoot = api.normalize(root);
  const normalizedCandidate = api.normalize(candidate);
  const rootVolume = api.parse(normalizedRoot).root;
  const candidateVolume = api.parse(normalizedCandidate).root;
  if (!rootVolume || !candidateVolume) return false;
  const sameVolume = flavor === "win32"
    ? normalizeWindowsVolume(rootVolume) === normalizeWindowsVolume(candidateVolume)
    : rootVolume === candidateVolume;
  if (!sameVolume) return false;
  const separator = flavor === "win32" ? /[\\/]+/u : /\/+/u;
  const rootParts = splitCanonicalComponents(normalizedRoot.slice(rootVolume.length), separator);
  const candidateParts = splitCanonicalComponents(normalizedCandidate.slice(candidateVolume.length), separator);
  if (rootParts.length > candidateParts.length) return false;
  return rootParts.every((component, index) => component === candidateParts[index]);
}

function normalizeWindowsVolume(value: string): string {
  return value.replaceAll("/", "\\").replace(/\\+$/u, "").toLowerCase();
}

function splitCanonicalComponents(value: string, separator: RegExp): string[] {
  return value.split(separator).filter(Boolean);
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
