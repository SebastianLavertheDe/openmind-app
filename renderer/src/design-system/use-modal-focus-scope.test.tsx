import { useRef } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalFocusScope } from "./use-modal-focus-scope";

afterEach(cleanup);

function Scope({
  label,
  layer,
  onDismiss
}: {
  label: string;
  layer: "modal" | "global";
  onDismiss(): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusScope({
    open: true,
    containerRef,
    onDismiss,
    layer
  });
  return (
    <div ref={containerRef} data-testid={label} tabIndex={-1}>
      <button>{label}</button>
    </div>
  );
}

function LayeredScopes({
  showModal,
  showGlobal,
  dismissModal,
  dismissGlobal
}: {
  showModal: boolean;
  showGlobal: boolean;
  dismissModal(): void;
  dismissGlobal(): void;
}) {
  return (
    <>
      {showModal ? <Scope label="modal" layer="modal" onDismiss={dismissModal} /> : null}
      {showGlobal
        ? createPortal(<Scope label="global" layer="global" onDismiss={dismissGlobal} />, document.body)
        : null}
    </>
  );
}

describe("useModalFocusScope", () => {
  it("does not steal focus after a user moves within a newly opened dialog", () => {
    const frames: FrameRequestCallback[] = [];
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    function FocusedDialog() {
      const containerRef = useRef<HTMLDivElement>(null), initialFocusRef = useRef<HTMLButtonElement>(null);
      useModalFocusScope({ open: true, containerRef, initialFocusRef, onDismiss() {} });
      return <div ref={containerRef}><button ref={initialFocusRef}>First</button><button>Second</button></div>;
    }
    const view = render(<FocusedDialog />);
    try {
      expect(document.activeElement).toBe(view.getByRole("button", { name: "First" }));
      const second = view.getByRole("button", { name: "Second" }); second.focus();
      act(() => { for (const callback of frames.splice(0)) callback(16); });
      expect(document.activeElement).toBe(second);
    } finally { view.unmount(); frame.mockRestore(); }
  });
  it("keeps the focused global layer isolated when an underlying modal registers later", async () => {
    const dismissModal = vi.fn();
    const dismissGlobal = vi.fn();
    const view = render(
      <LayeredScopes showModal={false} showGlobal dismissModal={dismissModal} dismissGlobal={dismissGlobal} />
    );
    const globalButton = within(view.getByTestId("global")).getByRole("button");
    await waitFor(() => expect(document.activeElement).toBe(globalButton));

    view.rerender(
      <LayeredScopes showModal showGlobal dismissModal={dismissModal} dismissGlobal={dismissGlobal} />
    );
    expect(view.container.inert).toBe(true);
    expect(view.container.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(globalButton);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(dismissGlobal).toHaveBeenCalledTimes(1);
    expect(dismissModal).not.toHaveBeenCalled();

    view.rerender(
      <LayeredScopes showModal showGlobal={false} dismissModal={dismissModal} dismissGlobal={dismissGlobal} />
    );
    expect(view.container.inert).toBe(false);
    expect(view.container.hasAttribute("aria-hidden")).toBe(false);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(dismissModal).toHaveBeenCalledTimes(1);
  });
});
