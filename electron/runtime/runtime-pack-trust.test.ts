import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimeTrustRoots, RuntimeTrustRootsError } from "./runtime-pack-trust";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runtime-pack-trust", () => {
  it("fails closed when development resources do not contain trust roots", () => {
    expect(loadRuntimeTrustRoots(path.join(os.tmpdir(), "cctools-runtime-trust-missing.json"))).toEqual({});
  });

  it("loads only Ed25519 public roots from the packaged schema", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-runtime-trust-"));
    roots.push(root);
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const pem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const file = path.join(root, "runtime-trust-roots.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, roots: { runtimeRoot: pem } }));
    expect(loadRuntimeTrustRoots(file)).toEqual({ runtimeRoot: pem });
  });

  it("rejects malformed and non-Ed25519 roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-runtime-trust-"));
    roots.push(root);
    const file = path.join(root, "runtime-trust-roots.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, roots: { runtimeRoot: "not-a-key" } }));
    expect(() => loadRuntimeTrustRoots(file)).toThrow(RuntimeTrustRootsError);

    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, roots: {
      runtimeRoot: rsa.publicKey.export({ type: "spki", format: "pem" }).toString()
    } }));
    expect(() => loadRuntimeTrustRoots(file)).toThrow(/Ed25519/);
  });
});

