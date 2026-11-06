import { describe, expect, it } from "vitest";
import { resolveInstalledSkillPath } from "./installed-skill-path";

const windowsRoot = String.raw`D:\work\openmind\.agent\skills`;
const unixRoot = "/home/say/work/github/cctools/.agent/skills";
const id = "rss-article-saver";
const windowsPackage = windowsRoot + "\\" + id;
const networkRoot = String.raw`\\server\share\openmind\.agent\skills`;
const networkPackage = networkRoot + "\\" + id;

describe("installed Skill paths across content-root copies", () => {
  it.each([
    [windowsPackage, unixRoot, `${unixRoot}/${id}`],
    [`${unixRoot}/${id}`, windowsRoot, windowsPackage],
    [windowsPackage, windowsRoot, windowsPackage],
    [`${unixRoot}/${id}`, unixRoot, `${unixRoot}/${id}`],
    [`${unixRoot}/${id}`, "/Users/example/OpenMind/.agent/skills", `/Users/example/OpenMind/.agent/skills/${id}`],
    [networkPackage, unixRoot, `${unixRoot}/${id}`],
    [`${unixRoot}/${id}`, networkRoot, networkPackage]
  ])("resolves %s against the selected store %s", (saved, current, expected) => {
    expect(resolveInstalledSkillPath(saved, id, current)).toBe(expected);
  });

  it.each([
    "/outside/package",
    `.agent/skills/${id}`,
    `/old/.agent/skills/../skills/${id}`,
    "/old/.agent/skills/other-skill",
    `/old/.agent/skills/cctools/${id}`
  ])("preserves unsupported or invalid paths for normal validation: %s", saved => {
    expect(resolveInstalledSkillPath(saved, id, unixRoot)).toBe(saved);
  });

  it("does not rebind an invalid Skill id", () => {
    const saved = "/old/.agent/skills/../outside";
    expect(resolveInstalledSkillPath(saved, "../outside", unixRoot)).toBe(saved);
  });
});
