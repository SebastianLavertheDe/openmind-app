import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "../paths/app-paths-service";

const MAX_CREDENTIAL_FILE_BYTES = 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Materializes an already-authorized credential-file value only for the
 * lifetime of one Broker Run. The adapter does not know how to decrypt a
 * Vault record and therefore cannot become a plaintext IPC surface.
 */
export class ManagedCredentialFileAdapter {
  constructor(private readonly paths: AppPaths) {}

  materialize(runId: string, credentialId: string, value: string): string {
    assertSafeSegment(runId, "Run ID");
    assertSafeSegment(credentialId, "Credential ID");
    if (!value || Buffer.byteLength(value, "utf8") > MAX_CREDENTIAL_FILE_BYTES) {
      throw new Error("Credential File 为空或超过 1 MiB，拒绝写入。 ");
    }
    const directory = path.join(this.paths.runs, runId, "work", "credentials");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, `${credentialId}.credential`);
    const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, filePath);
      try { fs.chmodSync(filePath, 0o600); } catch { /* Windows may not expose POSIX modes. */ }
      return filePath;
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  /** Best-effort and idempotent; called before Artifact collection and again on Broker exit. */
  cleanup(runId: string): void {
    assertSafeSegment(runId, "Run ID");
    const directory = path.join(this.paths.runs, runId, "work", "credentials");
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory)) {
      if (!entry.endsWith(".credential") && !entry.includes(".tmp-")) continue;
      const candidate = path.join(directory, entry);
      try {
        if (fs.lstatSync(candidate).isFile()) fs.rmSync(candidate, { force: false });
      } catch { /* cleanup remains best effort after process termination */ }
    }
    try { if (!fs.readdirSync(directory).length) fs.rmdirSync(directory); } catch { /* best effort */ }
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} 无效，拒绝生成 Credential File。`);
}

