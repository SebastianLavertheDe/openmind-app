import { z } from "zod";

export const APP_STATE_BACKUP_KIND = "cctools-app-state-backup" as const;
export const APP_STATE_BACKUP_SCHEMA_VERSION = 1 as const;

export const AppStateBackupReportSchema = z.object({
  schemaVersion: z.literal(APP_STATE_BACKUP_SCHEMA_VERSION),
  kind: z.literal(APP_STATE_BACKUP_KIND),
  operation: z.enum(["export", "import"]),
  createdAt: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
  excludedAreas: z.array(z.string().min(1)).min(1)
});
export type AppStateBackupReport = z.infer<typeof AppStateBackupReportSchema>;

export const AppStateBackupManifestFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i)
});

export const AppStateBackupManifestSchema = z.object({
  schemaVersion: z.literal(APP_STATE_BACKUP_SCHEMA_VERSION),
  kind: z.literal(APP_STATE_BACKUP_KIND),
  createdAt: z.string().min(1),
  files: z.array(AppStateBackupManifestFileSchema)
});
export type AppStateBackupManifest = z.infer<typeof AppStateBackupManifestSchema>;

/**
 * The archive is intentionally a portable state snapshot, not a clone of
 * the whole Electron userData directory. These exclusions prevent secrets,
 * executable/platform-specific resources, and transient work files from
 * crossing machines or being restored over live state.
 */
export const APP_STATE_BACKUP_EXCLUDED_AREAS = [
  "credentials/** and browser-extension-token.bin",
  "skills/** package bytes and Skill-owned data",
  "runtimes/** managed packs, environments and downloads",
  "catalog/**, updates/**, staging/**, cache/** and logs/**",
  "runs/**/work/** temporary files, credentials and collected artifacts",
  "state/**/.runtime/** and state/**/tmp-images/** temporary AI data",
  "temporary, lock and backup files"
] as const;

