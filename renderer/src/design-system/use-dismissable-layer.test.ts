import { describe, expect, it } from "vitest";
import { isDismissableBranch, registerDismissableLayer } from "./use-dismissable-layer";

describe("dismissable layer ancestry", () => {
  it("does not connect a lower modal or its menu through a focused higher dialog", () => {
    const root = document.createElement("div");
    const lowerModal = document.createElement("section");
    const lowerTrigger = document.createElement("button");
    const globalDialog = document.createElement("section");
    const globalTrigger = document.createElement("button");
    const lowerMenu = document.createElement("div");
    const globalMenu = document.createElement("div");
    root.append(lowerModal);
    lowerModal.append(lowerTrigger);
    globalDialog.append(globalTrigger);
    const unregister = [
      registerDismissableLayer({ contentRefs: [{ current: globalDialog }], modalPriority: 2, onDismiss() {} }),
      registerDismissableLayer({ contentRefs: [{ current: lowerModal }], triggerRef: { current: globalTrigger }, modalPriority: 1, onDismiss() {} }),
      registerDismissableLayer({ contentRefs: [{ current: lowerMenu }], triggerRef: { current: lowerTrigger }, onDismiss() {} }),
      registerDismissableLayer({ contentRefs: [{ current: globalMenu }], triggerRef: { current: globalTrigger }, onDismiss() {} })
    ];
    try {
      expect(isDismissableBranch(root, globalDialog)).toBe(false);
      expect(isDismissableBranch(lowerMenu, globalDialog)).toBe(false);
      expect(isDismissableBranch(globalMenu, globalDialog)).toBe(true);
    } finally {
      unregister.reverse().forEach(remove => remove());
    }
  });
});
