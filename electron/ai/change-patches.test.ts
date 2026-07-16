import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../../shared/contracts";
import {
  filePatchSegments,
  patchFingerprint,
  patchPath,
  patchSegments,
  remainingPatch
} from "./change-patches";

const TWO_HUNK_PATCH = `--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,3 @@
-line1
+line1-edited
 line2
 line3
@@ -5,3 +5,3 @@
 line5
-line6
+line6-edited
 line7
`;

const SINGLE_HUNK_PATCH = `--- a/bar.txt
+++ b/bar.txt
@@ -1,1 +1,1 @@
-old
+new
`;

function makeChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "cs-1",
    runId: "run-1",
    baseCommit: "abc",
    files: [],
    patch: "",
    createdAt: "2026-07-07T00:00:00.000Z",
    status: "pending",
    appliedPatches: [],
    appliedFiles: [],
    ...overrides
  };
}

describe("patchFingerprint", () => {
  it("returns a stable sha256 hex digest for the same input", () => {
    const a = patchFingerprint("hello");
    const b = patchFingerprint("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different input", () => {
    expect(patchFingerprint("a")).not.toBe(patchFingerprint("b"));
  });
});

describe("filePatchSegments", () => {
  it("splits a multi-hunk patch into one formatted segment per hunk", () => {
    const segments = filePatchSegments({ path: "foo.txt", status: "modified", additions: 2, deletions: 2, patch: TWO_HUNK_PATCH });
    expect(segments).toHaveLength(2);
    // each segment is itself a parseable single-hunk patch
    expect(segments[0]).toContain("@@ -1,3 +1,3 @@");
    expect(segments[1]).toContain("@@ -5,3 +5,3 @@");
  });

  it("falls back to the raw value when the patch cannot be parsed", () => {
    const segments = filePatchSegments({ path: "x", status: "modified", additions: 0, deletions: 0, patch: "not a patch at all" });
    expect(segments).toEqual(["not a patch at all"]);
  });
});

describe("patchPath", () => {
  it("strips the leading a/ or b/ prefix from the new file name", () => {
    expect(patchPath(TWO_HUNK_PATCH)).toBe("foo.txt");
    expect(patchPath(SINGLE_HUNK_PATCH)).toBe("bar.txt");
  });

  it("returns null when no file name can be derived", () => {
    expect(patchPath("garbage")).toBeNull();
  });
});

describe("patchSegments / remainingPatch", () => {
  it("returns every segment of every non-applied file", () => {
    const cs = makeChangeSet({
      files: [
        { path: "foo.txt", status: "modified", additions: 2, deletions: 2, patch: TWO_HUNK_PATCH },
        { path: "bar.txt", status: "modified", additions: 1, deletions: 1, patch: SINGLE_HUNK_PATCH }
      ]
    });
    expect(patchSegments(cs)).toHaveLength(3);
    // remainingPatch joins the same 3 segments with "\n"
    expect(remainingPatch(cs)).toBe(patchSegments(cs).join("\n"));
  });

  it("skips files listed in appliedFiles", () => {
    const cs = makeChangeSet({
      appliedFiles: ["foo.txt"],
      files: [
        { path: "foo.txt", status: "modified", additions: 2, deletions: 2, patch: TWO_HUNK_PATCH },
        { path: "bar.txt", status: "modified", additions: 1, deletions: 1, patch: SINGLE_HUNK_PATCH }
      ]
    });
    expect(patchSegments(cs)).toHaveLength(1);
  });

  it("skips individual hunks whose fingerprint is already in appliedPatches", () => {
    const firstHunkId = filePatchSegments({ path: "foo.txt", status: "modified", additions: 2, deletions: 2, patch: TWO_HUNK_PATCH })[0];
    const cs = makeChangeSet({
      appliedPatches: [patchFingerprint(firstHunkId)],
      files: [
        { path: "foo.txt", status: "modified", additions: 2, deletions: 2, patch: TWO_HUNK_PATCH }
      ]
    });
    expect(patchSegments(cs)).toHaveLength(1);
  });
});
