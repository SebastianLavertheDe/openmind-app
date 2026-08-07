import path from "node:path";
import type { ExternalBinding } from "../execution/artifact-collector";

/**
 * Resolve the output directory for a browser-capable Internal Agent.
 *
 * Browser evidence is an external artifact for formal Agent Skills. Never
 * fall back to the installed package or a hidden `.cctools` directory: an
 * absent/revoked binding must stop the run before a Browser session starts.
 */
export function resolveAgentBrowserOutputDir(
  artifacts: ReadonlyArray<{ externalExportId?: string }>,
  externalBindings?: Record<string, ExternalBinding>
): string {
  const ids = [...new Set(artifacts.map((artifact) => artifact.externalExportId).filter((id): id is string => Boolean(id)))];
  if (ids.length !== 1) throw new Error("Browser-capable Agent 必须声明唯一的外部证据导出绑定。 ");
  const binding = externalBindings?.[ids[0]];
  if (!binding || binding.revoked || !path.isAbsolute(binding.canonicalPath)) {
    throw new Error(`Browser 证据 Export Location Binding 不可用：${ids[0]}`);
  }
  return binding.canonicalPath;
}
