import { useListDetailLayout } from "./useListDetailLayout";

export function useContentListLayout() {
  return useListDetailLayout(
    // Compatibility key: retain existing content-list widths without rewriting user preferences.
    "openmind.list-detail.creative.v1",
    { listWidth: 280, listCollapsed: false },
    { legacyStorageKeys: ["openmind.three-pane.creative.v2"] }
  );
}
