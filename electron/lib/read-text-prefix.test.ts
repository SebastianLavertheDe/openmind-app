import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_PREVIEW_BYTES, readTextPrefix, readTextPrefixSync } from "./read-text-prefix";

const fixtures: string[] = [];
function fixture(content: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-text-prefix-"));
  fixtures.push(directory);
  const file = path.join(directory, "content.md");
  fs.writeFileSync(file, content);
  return file;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe.each([
  ["sync", readTextPrefixSync],
  ["async", readTextPrefix]
] as const)("bounded UTF-8 prefix (%s)", (_name, read) => {
  it.each(["", "中文与 emoji 😀", "x".repeat(CONTENT_PREVIEW_BYTES)])("preserves complete files without truncating", async (content) => {
    expect(await read(fixture(content))).toEqual({ content, truncated: false });
  });

  it.each(["中", "😀"])("does not split a UTF-8 character at the byte limit (%s)", async (character) => {
    const prefix = "x".repeat(CONTENT_PREVIEW_BYTES - 1);
    expect(await read(fixture(prefix + character + "tail"))).toEqual({ content: prefix, truncated: true });
  });

  it("rejects non-files", async () => {
    const file = fixture("");
    await expect(Promise.resolve().then(() => read(path.dirname(file)))).rejects.toThrow();
  });
});

it("sync reads at most the byte budget plus lookahead, even for a 64 MiB file", () => {
  const file = fixture("large");
  fs.truncateSync(file, 64 * 1024 * 1024);
  const fullRead = vi.spyOn(fs, "readFileSync");
  const read = vi.spyOn(fs, "readSync");
  expect(readTextPrefixSync(file)).toMatchObject({ truncated: true });
  expect(fullRead).not.toHaveBeenCalled();
  expect(read.mock.results.reduce((total, result) => total + Number(result.value), 0)).toBe(CONTENT_PREVIEW_BYTES + 1);
});

it("async reads are bounded and always close the handle, including on failure", async () => {
  const file = fixture("large");
  fs.truncateSync(file, 64 * 1024 * 1024);
  const handle = await fs.promises.open(file, "r");
  const read = vi.spyOn(handle, "read");
  const close = vi.spyOn(handle, "close");
  vi.spyOn(fs.promises, "open").mockResolvedValueOnce(handle);
  expect((await readTextPrefix(file)).truncated).toBe(true);
  expect(read.mock.calls[0][3]).toBe(0);
  expect(read.mock.calls[0][2]).toBe(CONTENT_PREVIEW_BYTES + 1);
  expect(close).toHaveBeenCalledOnce();

  const failing = await fs.promises.open(file, "r");
  vi.spyOn(failing, "read").mockRejectedValueOnce(new Error("read failed"));
  const closeAfterFailure = vi.spyOn(failing, "close");
  vi.mocked(fs.promises.open).mockResolvedValueOnce(failing);
  await expect(readTextPrefix(file)).rejects.toThrow("read failed");
  expect(closeAfterFailure).toHaveBeenCalledOnce();
});
