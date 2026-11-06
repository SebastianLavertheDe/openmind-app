import path from "node:path";
import { publishSkillRegistry } from "../electron/skills/skill-registry-publisher";

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "skill-registry");
const catalog = publishSkillRegistry(path.join(root, "config", "skill-library"), destination);
process.stdout.write(`Published ${catalog.skills.length} Skill packages to ${destination}.\n`);
