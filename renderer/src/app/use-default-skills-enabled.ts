import { useEffect, useState } from "react";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT } from "../installed-skill-events";

export function useDefaultSkillsEnabled(openmindRoot: string, validRepo: boolean): boolean {
  const [setting, setSetting] = useState({ root: openmindRoot, enabled: false });

  useEffect(() => {
    if (!validRepo) return;
    let request = 0;
    const refresh = async () => {
      const currentRequest = ++request;
      let enabled = false;
      try {
        enabled = await window.openmind.getDefaultSkillsEnabled();
      } catch {
        // Keep optional pages hidden until the saved switch state is known.
      }
      if (currentRequest === request) setSetting({ root: openmindRoot, enabled });
    };
    void refresh();
    window.addEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, refresh);
    return () => {
      request += 1;
      window.removeEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, refresh);
    };
  }, [openmindRoot, validRepo]);

  return validRepo && setting.root === openmindRoot && setting.enabled;
}
