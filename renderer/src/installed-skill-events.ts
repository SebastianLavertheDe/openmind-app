/** Renderer-local notification that an Installed Skill catalog changed. */
export const INSTALLED_SKILL_CATALOG_CHANGED_EVENT = "cctools:installed-skill-catalog-changed";

export function notifyInstalledSkillCatalogChanged(): void {
  window.dispatchEvent(new Event(INSTALLED_SKILL_CATALOG_CHANGED_EVENT));
}
