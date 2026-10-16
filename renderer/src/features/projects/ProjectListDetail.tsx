import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useResponsiveLayout, useResponsiveWorkspaceMinimum } from "../../app/responsive-layout";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useListDetailLayout } from "../../components/useListDetailLayout";

export function ProjectListDetail({
  storageKey,
  detailOpen,
  list,
  detail,
  detailLabel,
  onBack
}: {
  storageKey: string;
  detailOpen: boolean;
  list: ReactNode;
  detail: ReactNode;
  detailLabel: string;
  onBack(): void;
}) {
  useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  useResponsiveWorkspaceMinimum("--project-workspace-min", hostRef);
  const responsive = useResponsiveLayout();
  const layout = useListDetailLayout(storageKey, { listWidth: 264, listCollapsed: false });
  const single = responsive.workspace === "single";
  const showList = !single || !detailOpen;
  const showDetail = !single || detailOpen;
  const listPresence = useExitPresence(showList, 160);
  const detailPresence = useExitPresence(showDetail, 160);
  const stashedListRef = useRef(list);
  const stashedDetailRef = useRef(detail);
  const previousDetailOpenRef = useRef(detailOpen);
  const [direction, setDirection] = useState<"forward" | "back" | null>(null);

  useLayoutEffect(() => {
    if (showList) stashedListRef.current = list;
    if (showDetail) stashedDetailRef.current = detail;
  }, [detail, list, showDetail, showList]);

  useLayoutEffect(() => {
    if (single && previousDetailOpenRef.current !== detailOpen) {
      setDirection(detailOpen ? "forward" : "back");
    }
    previousDetailOpenRef.current = detailOpen;
  }, [detailOpen, single]);

  const listEntering = single && direction === "back" && showList && listPresence.visible && !listPresence.leaving;
  const detailEntering = single && direction === "forward" && showDetail && detailPresence.visible && !detailPresence.leaving;
  return (
    <div
      ref={hostRef}
      className={`project-list-detail${single ? " single" : " split"}${layout.isResizing ? " is-resizing" : ""}`}
      style={!single ? { "--project-list-detail-columns": layout.columns } as React.CSSProperties : undefined}
    >
      {listPresence.visible ? (
        <aside
          className="project-local-list"
          data-entering={listEntering || undefined}
          data-leaving={listPresence.leaving || undefined}
          aria-hidden={listPresence.leaving || undefined}
          inert={listPresence.leaving || undefined}
        >
          {showList ? list : stashedListRef.current}
        </aside>
      ) : null}
      {!single ? <ColumnSplitter
        side="left"
        collapsed={layout.layout.listCollapsed}
        ariaLabel={messages.projectUi.listWidth(detailLabel)}
        ariaValueMin={160}
        ariaValueMax={280}
        ariaValueNow={layout.layout.listWidth}
        toggle={layout.toggleList}
        resize={layout.resizeList}
        reset={layout.reset}
        onResizeStart={layout.beginListResize}
        onResizeCancel={layout.cancelListResize}
        onResizeActiveChange={layout.onResizeActiveChange}
      /> : null}
      {detailPresence.visible ? (
        <section
          className="project-local-detail"
          data-entering={detailEntering || undefined}
          data-leaving={detailPresence.leaving || undefined}
          aria-hidden={detailPresence.leaving || undefined}
          inert={detailPresence.leaving || undefined}
        >
          {single ? <button className="project-detail-back" data-motion="action" onClick={onBack}><ArrowLeft size={15} />{messages.projectUi.backToList(detailLabel)}</button> : null}
          {showDetail ? detail : stashedDetailRef.current}
        </section>
      ) : null}
    </div>
  );
}
