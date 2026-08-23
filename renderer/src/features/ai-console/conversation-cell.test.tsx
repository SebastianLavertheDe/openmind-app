import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationCell,
  ConversationCellActions,
  ConversationCellBody,
  ConversationCellHeader,
  ConversationCellMeta,
  ConversationStatusPill,
} from "./conversation-cell";

afterEach(() => cleanup());

describe("ConversationCell", () => {
  it("renders non-collapsible cell with header and body", () => {
    render(
      <ConversationCell
        tone="tool"
        icon={<span>X</span>}
        label="Tool"
        title="Read file"
        subtitle="src/app.ts"
      >
        <div>body content</div>
      </ConversationCell>
    );
    expect(screen.getByText("Tool")).toBeTruthy();
    expect(screen.getByText("Read file")).toBeTruthy();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByText("body content")).toBeTruthy();
  });

  it("renders as article when not collapsible", () => {
    const { container } = render(
      <ConversationCell tone="system" icon={<span>X</span>} label="System" title="Title" />
    );
    expect(container.querySelector("article.conversation-cell")).toBeTruthy();
  });

  it("renders collapsible variant as disclosure (collapsed keeps content inert)", () => {
    const { container } = render(
      <ConversationCell tone="error" icon={<span>X</span>} label="Error" title="Failed" collapsible defaultOpen={false}>
        <div>hidden detail</div>
      </ConversationCell>
    );
    const disclosure = container.querySelector(".ui-disclosure.conversation-cell");
    expect(disclosure).toBeTruthy();
    // AnimatedDisclosure keeps content mounted but inert when collapsed
    const inner = container.querySelector(".ui-disclosure-content-inner") as HTMLElement;
    expect(inner?.hasAttribute("inert")).toBe(true);
  });

  it("opens collapsible on trigger click", () => {
    const { container } = render(
      <ConversationCell tone="error" icon={<span>X</span>} label="Error" title="Failed" collapsible defaultOpen={false}>
        <div>hidden detail</div>
      </ConversationCell>
    );
    fireEvent.click(screen.getByRole("button"));
    // After open, inner content should no longer be inert
    const inner = container.querySelector(".ui-disclosure-content-inner") as HTMLElement;
    expect(inner?.hasAttribute("inert")).toBe(false);
    expect(screen.getByText("hidden detail")).toBeTruthy();
  });

  it("renders status pill with tone class", () => {
    const { container } = render(
      <ConversationCell tone="tool" icon={<span>X</span>} label="Tool" status="running" statusTone="running" />
    );
    const pill = container.querySelector(".conversation-status.running");
    expect(pill?.textContent).toBe("running");
  });

  it("renders meta when provided", () => {
    render(
      <ConversationCell tone="tool" icon={<span>X</span>} label="Tool" meta={<span>12s</span>} />
    );
    expect(screen.getByText("12s")).toBeTruthy();
  });

  it("renders actions when provided", () => {
    render(
      <ConversationCell tone="tool" icon={<span>X</span>} label="Tool" actions={<button>Run</button>} />
    );
    expect(screen.getByText("Run")).toBeTruthy();
  });

  it("applies tone and statusTone classes", () => {
    const { container } = render(
      <ConversationCell tone="changes" icon={<span>X</span>} label="Changes" statusTone="success" className="custom" />
    );
    const cell = container.querySelector(".conversation-cell.changes.success.custom");
    expect(cell).toBeTruthy();
  });
});

describe("ConversationCellHeader", () => {
  it("renders icon, label, title, subtitle", () => {
    const { container } = render(
      <ConversationCellHeader
        icon={<span>🔧</span>}
        label="Kicker"
        title={<span>Big Title</span>}
        subtitle={<span>Small subtitle</span>}
      />
    );
    expect(screen.getByText("Kicker")).toBeTruthy();
    expect(screen.getByText("Big Title")).toBeTruthy();
    expect(screen.getByText("Small subtitle")).toBeTruthy();
    expect(container.querySelector(".conversation-cell-icon")).toBeTruthy();
  });

  it("renders without optional fields", () => {
    const { container } = render(<ConversationCellHeader label="Only" />);
    expect(screen.getByText("Only")).toBeTruthy();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders status and meta", () => {
    render(
      <ConversationCellHeader
        label="X"
        meta={<span>meta-val</span>}
        status={<span>done</span>}
        statusTone="success"
      />
    );
    expect(screen.getByText("meta-val")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });
});

describe("ConversationCellBody", () => {
  it("wraps children in body div", () => {
    const { container } = render(<ConversationCellBody><p>inner</p></ConversationCellBody>);
    expect(container.querySelector(".conversation-cell-body")).toBeTruthy();
    expect(screen.getByText("inner")).toBeTruthy();
  });
});

describe("ConversationCellActions", () => {
  it("renders children inside actions wrapper", () => {
    const { container } = render(
      <ConversationCellActions onClick={() => undefined}>
        <button>Act</button>
      </ConversationCellActions>
    );
    const wrapper = container.querySelector(".conversation-cell-actions") as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(screen.getByText("Act")).toBeTruthy();
  });

  it("calls onClick wrapper handler when child button is clicked", () => {
    const onClick = vi.fn();
    render(
      <ConversationCellActions onClick={onClick}>
        <button>Delete</button>
      </ConversationCellActions>
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stopPropagation when collapsible (action click does not toggle disclosure)", () => {
    // 当 collapsible=true 时,actions 的点击不应触发展开/收起
    // 用 span 而非 button 避免 button 嵌套 button 的 HTML 警告
    const { container } = render(
      <ConversationCell
        tone="tool"
        icon={<span>X</span>}
        label="Tool"
        collapsible
        defaultOpen={false}
        actions={<span data-testid="act-btn" role="button">Action</span>}
      >
        <p>body</p>
      </ConversationCell>
    );
    // 默认收起
    const innerBefore = container.querySelector(".ui-disclosure-content-inner") as HTMLElement;
    expect(innerBefore.hasAttribute("inert")).toBe(true);
    // 点 action —— 不应展开 disclosure
    fireEvent.click(screen.getByTestId("act-btn"));
    const innerAfter = container.querySelector(".ui-disclosure-content-inner") as HTMLElement;
    expect(innerAfter.hasAttribute("inert")).toBe(true);
  });
});

describe("ConversationCellMeta", () => {
  it("wraps children in meta span", () => {
    const { container } = render(<ConversationCellMeta><span>3 files</span></ConversationCellMeta>);
    const meta = container.querySelector(".conversation-cell-meta");
    expect(meta).toBeTruthy();
    expect(screen.getByText("3 files")).toBeTruthy();
  });
});

describe("ConversationStatusPill", () => {
  it("renders with tone class", () => {
    const { container } = render(<ConversationStatusPill tone="warning">waiting</ConversationStatusPill>);
    const pill = container.querySelector(".conversation-status.warning");
    expect(pill?.textContent).toBe("waiting");
  });

  it("defaults to neutral tone", () => {
    const { container } = render(<ConversationStatusPill>idle</ConversationStatusPill>);
    const pill = container.querySelector(".conversation-status.neutral");
    expect(pill).toBeTruthy();
  });
});
