import { useEffect, useState } from "react";
import { useMotionPreference } from "./use-motion-preference";
import { useMotionTokens } from "./motion-tokens";

export function useCollectionMotion(count: number, maximum: number) {
  const reduced = useMotionPreference();
  const tokens = useMotionTokens();
  const [navigationMoving, setNavigationMoving] = useState(() => Boolean(document.querySelector("[data-nav-transitioning]")));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setNavigationMoving(Boolean(document.querySelector("[data-nav-transitioning]"))));
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-nav-transitioning"] });
    return () => observer.disconnect();
  }, []);
  return { enabled: !reduced && !navigationMoving && count <= maximum, reduced, tokens };
}
