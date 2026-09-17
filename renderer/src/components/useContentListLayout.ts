import { useListDetailLayout } from "./useListDetailLayout";

export function useContentListLayout() {
  return useListDetailLayout(
    // Retain the existing key so the creative list's saved width carries over.
    "openmind.list-detail.creative.v1",
    { listWidth: 280, listCollapsed: false },
    { legacyStorageKeys: ["openmind.three-pane.creative.v2"] }
  );
}
