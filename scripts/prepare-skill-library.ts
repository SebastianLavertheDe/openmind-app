import path from "node:path";
import { prepareSkillLibraryBundle } from "../electron/skills/skill-library-bundle";
import { publishSkillRegistry } from "../electron/skills/skill-registry-publisher";
import { BUILTIN_SKILL_IDS } from "../shared/skill-registry";

const root = path.resolve(__dirname, "..");
const config = path.join(root, "config", "skill-library");
const count = prepareSkillLibraryBundle(config, path.join(root, ".build", "skill-library"), { includeIds: BUILTIN_SKILL_IDS });
const registry = publishSkillRegistry(config, path.join(root, "skill-registry"));
process.stdout.write(`Prepared ${count} built-in Skill packages and published ${registry.skills.length} registry packages.\n`);
