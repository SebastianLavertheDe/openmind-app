import { type ReactNode, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useResponsiveLayout, useResponsiveWorkspaceMinimum } from "../../app/responsive-layout";
import { ColumnSplitter } from "../../components/ColumnSplitter";
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
  const hostRef = useRef<HTMLDivElement>(null);
  useResponsiveWorkspaceMinimum("--project-workspace-min", hostRef);
  const responsive = useResponsiveLayout();
  const layout = useListDetailLayout(storageKey, { listWidth: 264, listCollapsed: false });
  const single = responsive.workspace === "single";
  const showList = !single || !detailOpen;
  const showDetail = !single || detailOpen;
  return (
    <div
      ref={hostRef}
      className={`project-list-detail${single ? " single" : " split"}${layout.isResizing ? " is-resizing" : ""}`}
      style={!single ? { "--project-list-detail-columns": layout.columns } as React.CSSProperties : undefined}
    >
      {showList ? <aside className="project-local-list">{list}</aside> : null}
      {!single ? <ColumnSplitter
        side="left"
        collapsed={layout.layout.listCollapsed}
        ariaLabel={`${detailLabel}列表宽度`}
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
      {showDetail ? (
        <section className="project-local-detail">
          {single ? <button className="project-detail-back" onClick={onBack}><ArrowLeft size={15} />返回{detailLabel}列表</button> : null}
          {detail}
        </section>
      ) : null}
    </div>
  );
}
