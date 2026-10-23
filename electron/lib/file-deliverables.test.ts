// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileDeliverable } from "./file-deliverables";
import type { FileDeliverableRequest } from "../../shared/file-deliverables";

describe("file deliverable metadata", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-deliverables-")); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const resolve = (input: FileDeliverableRequest) => {
    const file = path.resolve(root, input.path);
    if (path.dirname(file) !== root) throw Error("outside");
    return file;
  };
  it.each([["deck.pptx", "file"], ["movie.mp4", "video"], ["cover.png", "image"], ["narration.wav", "audio"]])("checks %s without treating its binary bytes as text", (name, kind) => {
    fs.writeFileSync(path.join(root, name), Buffer.from([0, 255, 0, 1]));
    expect(readFileDeliverable({ path: name }, resolve)).toMatchObject({ name, kind, byteSize: 4 });
  });
  it("rejects missing files, directories, symlinks and requests outside the selected scope", () => {
    fs.mkdirSync(path.join(root, "folder.pptx"));
    fs.writeFileSync(path.join(root, "deck.pptx"), "fixture");
    for (const name of ["missing.pptx", "folder.pptx", "../deck.pptx"]) expect(() => readFileDeliverable({ path: name }, resolve)).toThrow();
    expect(() => readFileDeliverable({ path: "deck.pptx", root: "/" } as never, resolve)).toThrow();
    try { fs.symlinkSync(path.join(root, "deck.pptx"), path.join(root, "link.pptx")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
    expect(() => readFileDeliverable({ path: "link.pptx" }, resolve)).toThrow();
  });
});
