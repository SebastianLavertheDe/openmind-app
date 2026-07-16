/* ============================================================
   CC Tools · 设计稿交互脚本（8 屏统一版）
   - 统一注入导航 + 全局工具栏（按 body[data-page] 标记激活）
   - 深浅色主题切换（持久化到 localStorage）
   - 分栏拖拽 + 持久化、列表/筛选项选中、视图/检视标签
   - 通用 toggle / segmented 控件、表格行选中
   - 内联 AI 演示、AI 会话发送演示
   注：AI 生成/回复均为本地静态演示文本，不调用真实模型。
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  /* ---------- 图标 ---------- */
  const I = {
    home: '<path d="M3 11 12 3l9 8M5 10v10h14V10"/>',
    inbox: '<path d="M3 13a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8 3 3 0 0 1-3 3h-2l-2-3a4 4 0 0 0-4 0l-2 3H6a3 3 0 0 1-3-3Z"/><path d="M7 19v1M17 19v1"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
    pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    command: '<path d="M9 6 3 4v14l6 2 6-2 6 2V6l-6-2-6 2ZM9 6v14M15 4v14"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 4h6M9 14h.01M15 14h.01M9 17h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5v.2M12 17h.01"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    navCollapse: '<path d="m11 7-4 5 4 5"/><path d="m18 7-4 5 4 5"/>',
    navExpand: '<path d="m13 7 4 5-4 5"/><path d="m6 7 4 5-4 5"/>',
  };

  /* ---------- 8 个导航项 ---------- */
  const PAGES = [
    { id: "dashboard", label: "今日工作台", icon: "home", href: "dashboard.html" },
    { id: "inbox", label: "资料收集箱", icon: "inbox", href: "reading.html", badge: "3" },
    { id: "sources", label: "数据源", icon: "database", href: "sources.html" },
    { id: "brief", label: "每日简报", icon: "calendar", href: "brief.html" },
    { id: "creative", label: "创作中心", icon: "pen", href: "creative.html" },
    { id: "automation", label: "自动化", icon: "command", href: "automation.html" },
    { id: "ai", label: "AI 工作台", icon: "bot", href: "ai.html", badge: "1" },
    { id: "settings", label: "设置", icon: "settings", href: "settings.html" },
  ];

  /* ---------- 统一外壳 ---------- */
  function activePage() { return document.body.dataset.page || ""; }

  function renderNav() {
    const nav = $("#appNav");
    if (!nav) return;
    const cur = activePage();
    const links = PAGES.map((p) => {
      const cls = p.id === cur ? "active" : "";
      const badge = p.badge ? `<span class="badge">${p.badge}</span>` : "";
      return `<a href="${p.href}" class="${cls}" ${p.id === cur ? 'aria-current="page"' : ""}>${svg(I[p.icon])}<span>${p.label}</span>${badge}</a>`;
    }).join("");
    nav.innerHTML =
      `<div class="app-brand"><div class="brand-mark">CC</div><div class="brand-copy"><strong>CC Tools</strong><span>CONTENT WORKSPACE</span></div><button class="nav-collapse-btn" id="navCollapse" title="收起导航" aria-label="收起导航" aria-expanded="true">${svg(I.navCollapse)}</button></div>` +
      `<nav aria-label="主导航">${links}</nav>` +
      `<div class="app-project-status"><span class="dot"></span><div><strong>本地已连接</strong><span>~/cctools</span></div></div>`;
  }

  function renderToolbar() {
    const bar = $("#globalToolbar");
    if (!bar) return;
    bar.innerHTML =
      `<button class="global-search">${svg(I.search)}<span>搜索资料、创作和会话</span><kbd>Ctrl K</kbd></button>` +
      `<div class="spacer"></div>` +
      `<div class="global-toolbar-status"><span class="dot"></span>本地数据已连接</div>` +
      `<button class="icon-button" id="themeToggle" title="切换深浅色" aria-label="切换深浅色"></button>` +
      `<button class="icon-button" title="通知" aria-label="查看通知">${svg(I.bell)}</button>` +
      `<button class="icon-button" title="帮助" aria-label="打开帮助">${svg(I.help)}</button>`;
  }

  /* ---------- 主题 ---------- */
  const THEME_KEY = "cctools-theme";
  function getTheme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  let themeT;
  function setTheme(t, animate) {
    const root = document.documentElement;
    const changed = root.getAttribute("data-theme") !== t;
    root.setAttribute("data-theme", t);
    try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
    const btn = $("#themeToggle");
    if (btn) btn.innerHTML = t === "dark" ? svg(I.sun) : svg(I.moon);
    $$("[data-theme-opt]").forEach((b) => { const on = b.dataset.themeOpt === t; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    if (animate && changed) {
      root.classList.add("theme-transitioning");
      clearTimeout(themeT);
      themeT = setTimeout(() => root.classList.remove("theme-transitioning"), 280);
    }
  }
  /* ---------- 导航折叠 ---------- */
  function initNavCollapse() {
    const nav = $("#appNav");
    if (!nav) return;
    const btn = $("#navCollapse");
    let collapsed = false;
    try { collapsed = localStorage.getItem("cctools-nav-collapsed") === "1"; } catch (_) {}
    const apply = (c) => {
      nav.classList.toggle("collapsed", c);
      document.documentElement.style.setProperty("--nav-width", c ? "64px" : "236px");
      if (btn) {
        btn.innerHTML = svg(c ? I.navExpand : I.navCollapse);
        btn.setAttribute("aria-expanded", String(!c));
        const label = c ? "展开导航" : "收起导航";
        btn.title = label; btn.setAttribute("aria-label", label);
      }
    };
    apply(collapsed);
    if (btn) btn.addEventListener("click", () => {
      collapsed = !collapsed;
      try { localStorage.setItem("cctools-nav-collapsed", collapsed ? "1" : "0"); } catch (_) {}
      apply(collapsed);
    });
  }

  function initTheme() {
    let t = "light";
    try { t = localStorage.getItem(THEME_KEY) || "light"; } catch (_) {}
    setTheme(t, false);
    document.addEventListener("click", (e) => {
      const toggle = e.target.closest("#themeToggle");
      if (toggle) { setTheme(getTheme() === "dark" ? "light" : "dark"); syncSegThumbs(true); return; }
      const opt = e.target.closest("[data-theme-opt]");
      if (opt) { setTheme(opt.dataset.themeOpt); syncSegThumbs(true); }
    });
  }

  /* ---------- 分栏拖拽 ---------- */
  function initSplitters() {
    $$(".three-pane, .creative-pane, .auto-layout, .ai-workbench").forEach((grid) => {
      const key = grid.dataset.paneStorage;
      const varName = grid.classList.contains("creative-pane") ? "--creative-columns" : grid.classList.contains("auto-layout") ? "--auto-columns" : grid.classList.contains("ai-workbench") ? "--ai-columns" : "--three-pane-columns";
      const minmax = grid.dataset.minmax ? JSON.parse(grid.dataset.minmax) : { 0: [160, 300], 2: [240, 440] };
      if (key) { try { const s = JSON.parse(localStorage.getItem(key) || "null"); if (s) grid.style.setProperty(varName, s); } catch (_) {} }
      $$(".splitter", grid).forEach((handle) => {
        const idx = Number(handle.dataset.resize);
        handle.setAttribute("role", "separator");
        handle.tabIndex = 0;
        const apply = (dx) => {
          const cols = (grid.style.getPropertyValue(varName) || getComputedStyle(grid).gridTemplateColumns).split(/\s+/).filter(Boolean);
          const cur = parseFloat(cols[idx]) || 200;
          const next = clamp(cur + dx, minmax[idx][0], minmax[idx][1]);
          cols[idx] = next + "px";
          const val = cols.join(" ");
          grid.style.setProperty(varName, val);
          if (key) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }
        };
        const onDown = (e) => {
          e.preventDefault();
          handle.classList.add("active");
          let last = e.touches ? e.touches[0].clientX : e.clientX;
          const onMove = (ev) => { const x = ev.touches ? ev.touches[0].clientX : ev.clientX; apply(x - last); last = x; };
          const onUp = () => { handle.classList.remove("active"); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onUp); };
          document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
          document.addEventListener("touchmove", onMove, { passive: false }); document.addEventListener("touchend", onUp);
        };
        handle.addEventListener("mousedown", onDown); handle.addEventListener("touchstart", onDown, { passive: false });
      });
    });
  }

  /* ---------- 列表 / 筛选 选中 ---------- */
  function initSelections() {
    $$("[data-select-group]").forEach((group) => {
      $$("[data-select]", group).forEach((btn) => btn.addEventListener("click", () => {
        $$("[data-select]", group).forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        syncSegThumbs(true);
      }));
    });
  }

  /* ---------- 视图 / 检视标签 ---------- */
  function fadeIn(el) { if (!el) return; el.classList.remove("view-in"); void el.offsetWidth; el.classList.add("view-in"); }

  function initViewTabs() {
    $$("[data-view-tabs]").forEach((bar) => {
      const target = bar.dataset.target ? $("#" + bar.dataset.target) : null;
      $$("button", bar).forEach((btn) => btn.addEventListener("click", () => {
        $$("button", bar).forEach((b) => b.classList.remove("active")); btn.classList.add("active");
        const view = btn.dataset.view;
        if (target) {
          $$(".editor-area, .preview-area", target).forEach((el) => (el.style.display = "none"));
          const show = view === "preview" ? $(".preview-area", target) : $(".editor-area", target);
          if (show) { show.style.display = ""; fadeIn(show); }
        }
      }));
    });
    $$("[data-inspector-tabs]").forEach((bar) => {
      const body = bar.nextElementSibling;
      $$("button", bar).forEach((btn) => btn.addEventListener("click", () => {
        $$("button", bar).forEach((b) => b.classList.remove("active")); btn.classList.add("active");
        if (!body) return;
        $$("[data-inspector-panel]", body).forEach((p) => (p.style.display = "none"));
        const panel = $('[data-inspector-panel="' + btn.dataset.panel + '"]', body);
        if (panel) panel.style.display = "";
      }));
    });
    $$("[data-tabs]").forEach((bar) => {
      const target = bar.dataset.target ? $("#" + bar.dataset.target) : null;
      $$("button", bar).forEach((btn) => btn.addEventListener("click", () => {
        $$("button", bar).forEach((b) => b.classList.remove("active")); btn.classList.add("active");
        if (!target) return;
        $$("[data-tab-panel]", target).forEach((p) => (p.style.display = "none"));
        const panel = $('[data-tab-panel="' + btn.dataset.tab + '"]', target);
        if (panel) panel.style.display = "";
      }));
    });
  }

  /* ---------- 通用开关 / 分段 ---------- */
  function initToggles() {
    $$("[data-toggle]").forEach((btn) => {
      const on = btn.getAttribute("aria-checked") === "true";
      btn.classList.toggle("on", on);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = !btn.classList.contains("on");
        btn.classList.toggle("on", next); btn.setAttribute("aria-checked", String(next));
      });
    });
  }
  function initSegmented() {
    $$("[data-segmented]").forEach((group) => {
      const v = group.dataset.var;
      const name = group.dataset.name;
      if (name) {
        try {
          const saved = localStorage.getItem("cctools-" + name);
          if (saved && v) {
            document.documentElement.style.setProperty(v, saved);
            $$("button", group).forEach((b) => b.classList.toggle("active", b.dataset.val === saved));
          }
        } catch (_) {}
      }
      $$("button", group).forEach((btn) => {
        btn.addEventListener("click", () => {
          $$("button", group).forEach((b) => { const on = b === btn; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
          if (v && btn.dataset.val) { document.documentElement.style.setProperty(v, btn.dataset.val); if (name) { try { localStorage.setItem("cctools-" + name, btn.dataset.val); } catch (_) {} } }
          syncSegThumbs(true);
        });
      });
    });
  }

  /* ---------- 表格行选中 → 检视器 ---------- */
  function initRowSelect() {
    $$("[data-rowlist]").forEach((list) => {
      $$("[data-row]", list).forEach((row) => row.addEventListener("click", () => {
        $$("[data-row]", list).forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
        const target = row.dataset.fill;
        if (!target) return;
        const ins = $('[data-inspector="' + target + '"]');
        if (ins) {
          $$("[data-inspector-pane]").forEach((p) => (p.style.display = "none"));
          ins.style.display = "";
        }
      }));
    });
  }

  /* ---------- 内联 AI 演示（创作页）---------- */
  function rewrite(text, mode) {
    const t = text.trim();
    if (mode === "shorten") return (t.split(/(?<=[。.!?！？])/).slice(0, 2).join("")) || t;
    if (mode === "translate") return "（翻译演示）" + t;
    return t.replace(/不是.{0,12}?, ?而是/g, "其实是").replace(/我们需要/g, "得").replace(/通过/g, "靠").replace(/能够/g, "能").replace(/进行/g, "做");
  }
  function initInlineAi() {
    const root = $("#inlineAi"), editor = $("#editor");
    if (!root || !editor) return;
    const selBar = $(".inline-ai-selection", root), selLabel = $("#aiSelLabel", root);
    const preview = $(".inline-ai-preview", root), out = $("#aiOut", root), foot = $("#aiFoot", root), eyebrow = $("#aiEyebrow", root);
    let range = null;
    const seed = "把写 Prompt 当成许愿";
    const at = editor.value.indexOf(seed);
    if (at >= 0) { range = { start: at, end: at + seed.length, text: seed }; selLabel.textContent = "已选中 " + seed.length + " 字 · 试试 改写"; }
    const readSel = () => {
      const { selectionStart: s, selectionEnd: e, value } = editor;
      if (e > s) { range = { start: s, end: e, text: value.slice(s, e) }; selLabel.textContent = "已选中 " + range.text.length + " 字"; selBar.style.display = ""; fadeIn(selBar); }
    };
    ["select", "mouseup", "keyup"].forEach((ev) => editor.addEventListener(ev, readSel));
    const start = (mode) => {
      if (!range) return;
      selBar.style.display = "none"; preview.style.display = ""; fadeIn(preview); out.textContent = "…";
      eyebrow.innerHTML = '<svg class="spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg> 生成中';
      foot.style.display = "none";
      const result = rewrite(range.text, mode);
      if (prefersReducedMotion) {
        out.textContent = result;
        eyebrow.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg> AI 结果'; foot.style.display = "";
      } else {
        let i = 0;
        const tick = () => { i += Math.max(2, Math.round(result.length / 24)); out.textContent = result.slice(0, i); if (i < result.length) setTimeout(tick, 28); else { eyebrow.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg> AI 结果'; foot.style.display = ""; } };
        setTimeout(tick, 420);
      }
    };
    $$("[data-ai-action]", selBar).forEach((b) => b.addEventListener("click", () => start(b.dataset.aiAction)));
    $("#aiAccept", root).addEventListener("click", () => { if (!range) return; editor.focus(); editor.setRangeText(out.textContent, range.start, range.end, "end"); preview.style.display = "none"; foot.style.display = "none"; range = null; selBar.style.display = "none"; });
    $("#aiRetry", root).addEventListener("click", () => { if (range) start("rewrite"); });
    $("#aiDiscard", root).addEventListener("click", () => { preview.style.display = "none"; foot.style.display = "none"; range = null; selBar.style.display = "none"; });
  }

  /* ---------- AI 会话发送演示 ---------- */
  function initComposer() {
    const ta = $("#composerInput"), send = $("#composerSend"), scroll = $("#chatScroll");
    if (!ta || !send || !scroll) return;
    const send_ = () => {
      const text = ta.value.trim();
      if (!text) return;
      const userMsg = document.createElement("div");
      userMsg.className = "message user";
      userMsg.innerHTML = `<div class="message-meta"><span>你</span><time>刚刚</time></div><div class="user-message"><p></p></div>`;
      userMsg.querySelector("p").textContent = text;
      scroll.append(userMsg); ta.value = "";
      const thinking = document.createElement("div");
      thinking.className = "message assistant";
      thinking.innerHTML = `<div class="message-meta"><span>助手</span><time>正在思考…</time></div><div class="assistant-message"><div class="chat-markdown"><p class="muted">正在生成…</p></div></div>`;
      scroll.append(thinking); scroll.scrollTop = scroll.scrollHeight;
      const reply = "已收到。基于本地资料库，我的初步思路是：先把问题拆成可观测的最小步骤，再逐个验证假设。需要我把它整理成一份草稿吗？";
      const target = thinking.querySelector(".chat-markdown");
      if (prefersReducedMotion) {
        target.innerHTML = "<p>" + reply + "</p>";
        thinking.querySelector("time").textContent = "刚刚";
      } else {
        let i = 0;
        const tick = () => { i += Math.max(2, Math.round(reply.length / 30)); target.innerHTML = "<p>" + reply.slice(0, i) + "</p>"; scroll.scrollTop = scroll.scrollHeight; if (i < reply.length) setTimeout(tick, 30); else thinking.querySelector("time").textContent = "刚刚"; };
        setTimeout(tick, 500);
      }
    };
    send.addEventListener("click", send_);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send_(); }
    });
  }

  /* ---------- boot ---------- */
  function syncSegThumbs(animate) {
    $$(".segmented").forEach((seg) => {
      const btns = $$("button", seg);
      if (!btns.length) return;
      seg.style.setProperty("--seg-n", String(btns.length));
      let thumb = $(".seg-thumb", seg);
      if (!thumb) { thumb = document.createElement("span"); thumb.className = "seg-thumb"; seg.insertBefore(thumb, seg.firstChild); }
      const idx = Math.max(0, btns.findIndex((b) => b.classList.contains("active")));
      if (!animate) thumb.style.transition = "none";
      thumb.style.transform = "translateX(" + idx * 100 + "%)";
      if (!animate) requestAnimationFrame(() => { thumb.style.transition = ""; });
    });
  }

  function boot() {
    renderNav(); initNavCollapse(); renderToolbar(); initTheme();
    initSplitters(); initSelections(); initViewTabs();
    initToggles(); initSegmented(); initRowSelect();
    $$(".segmented button").forEach((b) => b.setAttribute("aria-pressed", b.classList.contains("active") ? "true" : "false"));
    syncSegThumbs(false);
    initInlineAi(); initComposer();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
