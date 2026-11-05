import { useEffect, useRef } from "react";
import type { ProjectMaterial } from "./types";

export function isMaterialProcessing(material: Pick<ProjectMaterial, "status">): boolean {
  return material.status === "importing" || material.status === "converting";
}

/** Jobs belong to Main; a mounted view only observes their persisted status. */
export function useMaterialProcessingRefresh(projectName: string, materials: ProjectMaterial[], refresh: () => Promise<void>): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const processing = materials.some(isMaterialProcessing);
  useEffect(() => {
    if (!processing) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refreshRef.current(); }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 1_000); }
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [projectName, processing]);
}
