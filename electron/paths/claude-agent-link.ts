import fs from "node:fs";
import path from "node:path";

export type ClaudeAgentLinkResult = {
  claudePath: string;
  agentPath: string;
  created: boolean;
  legacyPath: string | null;
};

/**
 * Expose the OpenMind `.agent` directory as Claude Code's project `.claude`
 * directory. Existing `.claude` content is preserved under
 * `.agent/legacy-claude`; non-conflicting entries (for example settings.json)
 * are moved into `.agent` before the link becomes active.
 */
export function ensureClaudeAgentLink(openmindRoot: string): ClaudeAgentLinkResult {
  const root = fs.realpathSync(path.resolve(openmindRoot));
  const agentPath = path.join(root, ".agent");
  const claudePath = path.join(root, ".claude");
  fs.mkdirSync(agentPath, { recursive: true });

  if (!pathEntryExists(claudePath)) {
    createDirectoryLink(agentPath, claudePath);
    return { claudePath, agentPath, created: true, legacyPath: null };
  }

  const linkStat = fs.lstatSync(claudePath);
  if (linkStat.isSymbolicLink()) {
    if (fs.realpathSync(claudePath) !== fs.realpathSync(agentPath)) {
      throw new Error(".claude 已是指向其他位置的链接，无法改为指向 .agent。");
    }
    return { claudePath, agentPath, created: false, legacyPath: null };
  }
  if (!linkStat.isDirectory()) throw new Error(".claude 已存在且不是目录链接。");

  const legacyPath = path.join(agentPath, "legacy-claude");
  if (pathEntryExists(legacyPath)) {
    throw new Error(".claude 是真实目录，且 .agent/legacy-claude 已存在；请先处理该冲突。");
  }

  // Rename first so creating the link never deletes or overwrites user data.
  fs.renameSync(claudePath, legacyPath);
  try {
    createDirectoryLink(agentPath, claudePath);
  } catch (error) {
    fs.renameSync(legacyPath, claudePath);
    throw error;
  }

  // Keep ordinary Claude project configuration active when it does not
  // collide with an app-managed `.agent` entry. Conflicts stay in the backup.
  for (const entry of fs.readdirSync(legacyPath)) {
    const source = path.join(legacyPath, entry);
    const destination = path.join(agentPath, entry);
    if (!pathEntryExists(destination)) fs.renameSync(source, destination);
  }
  if (fs.readdirSync(legacyPath).length === 0) fs.rmdirSync(legacyPath);

  return {
    claudePath,
    agentPath,
    created: true,
    legacyPath: pathEntryExists(legacyPath) ? legacyPath : null
  };
}

/** Make publisher-nested historical installs visible to native discovery. */
export function ensureClaudeSkillAliases(skillsRoot: string): string[] {
  if (!fs.existsSync(skillsRoot)) return [];
  const created: string[] = [];
  for (const publisher of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!publisher.isDirectory() || publisher.isSymbolicLink()) continue;
    const publisherRoot = path.join(skillsRoot, publisher.name);
    for (const skill of fs.readdirSync(publisherRoot, { withFileTypes: true })) {
      if (!skill.isDirectory() || skill.isSymbolicLink()) continue;
      const packageRoot = path.join(publisherRoot, skill.name);
      if (!fs.existsSync(path.join(packageRoot, "SKILL.md"))) continue;
      const alias = path.join(skillsRoot, skill.name);
      if (pathEntryExists(alias)) {
        // A prior compatibility link may be dangling after its historical
        // publisher-nested package was uninstalled. Only replace links; never
        // overwrite an ordinary file or directory owned by the user.
        const aliasStat = fs.lstatSync(alias);
        if (!aliasStat.isSymbolicLink()) continue;
        try {
          if (fs.realpathSync(alias) === fs.realpathSync(packageRoot)) continue;
        } catch {
          // Broken link: safe to remove and recreate below.
        }
        fs.unlinkSync(alias);
      }
      createDirectoryLink(packageRoot, alias);
      created.push(alias);
    }
  }
  return created;
}

function createDirectoryLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function pathEntryExists(entryPath: string): boolean {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
