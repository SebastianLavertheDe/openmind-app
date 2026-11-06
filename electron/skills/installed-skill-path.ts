import path from "node:path";

/** Flat installed packages travel with the content root, not their original host. */
export function resolveInstalledSkillPath(packagePath: string, skillId: string, skillsRoot: string): string {
  // Only rebind the managed flat layout. Other legacy or invalid paths retain
  // their existing diagnostics; never turn arbitrary paths into valid installs.
  const normalized = packagePath.replace(/\\/g, "/");
  if (!/^[a-z][a-z0-9-._]*$/.test(skillId)
    || !(path.posix.isAbsolute(packagePath) || path.win32.isAbsolute(packagePath))
    || normalized.split("/").some(segment => segment === "." || segment === "..")
    || !normalized.endsWith(`/.agent/skills/${skillId}`)) return packagePath;

  const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(skillsRoot) ? path.win32 : path.posix;
  return paths.join(skillsRoot, skillId);
}
