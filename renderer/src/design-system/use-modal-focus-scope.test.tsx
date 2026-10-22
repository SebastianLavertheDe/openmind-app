import { useRef } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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
