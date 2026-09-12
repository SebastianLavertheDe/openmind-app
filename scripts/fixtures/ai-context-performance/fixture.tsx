import { Profiler, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AiProvider, useAiActions, useAiUi } from "../../../renderer/src/ai-context";
import { AiSidebar } from "../../../renderer/src/components/AiSidebar";
import { ResponsiveLayoutProvider } from "../../../renderer/src/app/responsive-layout";
import { CreativeWorkspacePage } from "../../../renderer/src/features/creative/CreativePage";
import { ProjectsPage } from "../../../renderer/src/features/projects/ProjectsPage";
import "../../../renderer/src/styles.css";
import "../../../renderer/src/styles/product.css";

// 真实页面组件 + 真实 AI 侧栏 + visual fixture 预载 API（不连真实用户数据）。
// React Profiler 统计页面子树的提交次数：页面迁移到 slice hooks 后，AI 流式
// 输出 / durable 事件 / snapshot 推送都不应再让整页重渲染（pageRenders === 0）。
const probe = window as any;
const page = new URLSearchParams(location.search).get("page") === "creative" ? "creative" : "projects";
probe.pageRenders = { [page]: 0 };
probe.benchReady = false;

function BenchController() {
  const ui = useAiUi();
  const actions = useAiActions();
  useEffect(() => {
    ui.setPanelMode("default");
    // AiProvider 挂载时会在自己的子效应之后重新选中初始会话；延迟到那之后
    // 再切换到流式会话，避免选择被覆盖。
    const timer = window.setTimeout(() => {
      void actions.setActiveSession("session-2").then(() => { probe.benchReady = true; });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actions.setActiveSession, ui.setPanelMode]);
  return null;
}

function Fixture() {
  const [bootstrap, setBootstrap] = useState<any>(null);
  useEffect(() => { void (window as any).openmind.getBootstrap().then(setBootstrap); }, []);
  if (!bootstrap) return null;
  return (
    <ResponsiveLayoutProvider>
      <AiProvider storageScope="ai-context-benchmark" initial={bootstrap.ai} skills={bootstrap.skills}>
        <BenchController />
        <div className="ai-context-bench">
          <Profiler id={page} onRender={() => { probe.pageRenders[page] += 1; }}>
            <main className="bench-page" data-bench-page={page}>
              {page === "creative" ? <CreativeWorkspacePage /> : <ProjectsPage />}
            </main>
          </Profiler>
          <AiSidebar />
        </div>
      </AiProvider>
    </ResponsiveLayoutProvider>
  );
}

const style = document.createElement("style");
style.textContent = `
html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}
.ai-context-bench{display:grid;grid-template-columns:minmax(0,1fr) auto;height:100%;min-height:0;overflow:hidden}
.bench-page{min-width:0;height:100%;min-height:0;overflow:auto}
`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<Fixture />);
