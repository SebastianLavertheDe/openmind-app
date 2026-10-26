import path from "node:path";
import { prepareSkillLibraryBundle } from "../electron/skills/skill-library-bundle";

const root = path.resolve(__dirname, "..");
const count = prepareSkillLibraryBundle(path.join(root, "config", "skill-library"), path.join(root, ".build", "skill-library"));
process.stdout.write(`Prepared ${count} App-owned Skill packages.\n`);
