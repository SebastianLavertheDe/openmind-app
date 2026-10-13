import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Copy, ImagePlus, LoaderCircle, Send, Settings2, X } from "lucide-react";
import { renderWechatArticle, WECHAT_THEMES } from "@shared/wechat-format";
import type { WechatAccountView, WechatCover } from "@shared/wechat";
import { WECHAT_TITLE_MAX_LENGTH, WECHAT_AUTHOR_MAX_LENGTH, WECHAT_DIGEST_MAX_LENGTH } from "@shared/wechat";
import { useModalFocusScope, Input, Textarea } from "../../design-system/components";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { WechatAccountForm } from "./WechatAccountForm";
import "../../styles/features/wechat-export.css";

const COLORS = [
  { name: "墨绿", value: "#27835c" }, { name: "海蓝", value: "#2563a6" },
  { name: "朱红", value: "#b63d36" }, { name: "琥珀", value: "#946719" },
  { name: "青色", value: "#187580" }, { name: "紫色", value: "#7854a6" },
  { name: "石墨", value: "#49515e" }
];

export function WechatExportDialog({ open, projectName, outputPath, title, markdown, onClose, onExited }: {
  open: boolean; projectName: string; outputPath: string; title: string; markdown: string; onClose(): void; onExited?(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const { visible, leaving } = useExitPresence(open, 160);
  const [themeId, setThemeId] = useState("pure");
  const [accentColor, setAccentColor] = useState(WECHAT_THEMES[0].accentColor);
  const [fontSize, setFontSize] = useState(16);
  const [draftOpen, setDraftOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState<WechatAccountView | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");
  const [articleTitle, setArticleTitle] = useState(title);
  const [author, setAuthor] = useState("");
  const [digest, setDigest] = useState("");
  const [cover, setCover] = useState<WechatCover | null>(null);
  const [busy, setBusy] = useState<"copy" | "cover" | "push" | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sentPayload, setSentPayload] = useState("");
  const busyRef = useRef(false);
  const dismiss = () => { if (!busyRef.current && !accountBusy) onClose(); };
  useModalFocusScope({ open: open && visible, containerRef: dialogRef, onDismiss: dismiss, layer: "global" });
  useEffect(() => { if (!open && !visible) onExited?.(); }, [open, visible, onExited]);

  const article = useMemo(() => {
    try { return { ...renderWechatArticle(markdown, { themeId, accentColor, fontSize }), error: "" }; }
    catch { return { html: "", text: "", warnings: [], error: "这篇文档暂时无法排版，请检查内容后重试。" }; }
  }, [markdown, themeId, accentColor, fontSize]);
  const preview = useMemo(() => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline';"><style>html{background:#fff;color-scheme:light}body{margin:0;padding:28px 24px;overflow-wrap:anywhere}a{pointer-events:none}</style></head><body>${article.html}</body></html>`, [article.html]);
  const payload = JSON.stringify({ projectName, outputPath, title: articleTitle.trim(), html: article.html, author: author.trim(), digest: digest.trim(), coverPath: cover?.path, appId: account?.appId });
  const sent = sentPayload === payload;
  const colors = COLORS.some(color => color.value === accentColor) ? COLORS : [{ name: "主题默认色", value: accentColor }, ...COLORS];

  useEffect(() => {
    if (!open) return;
    let current = true;
    setAccountLoading(true);
    setAccountError("");
    void window.openmind.getWechatAccount().then(next => {
      if (current) { setAccount(next); setAuthor(next.author); }
    }).catch(cause => { if (current) setAccountError(errorText(cause)); })
      .finally(() => { if (current) setAccountLoading(false); });
    return () => { current = false; };
  }, [open]);

  const run = async (operation: "copy" | "cover" | "push", action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(operation); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(errorText(cause)); }
    finally { busyRef.current = false; setBusy(null); }
  };
  const copy = () => run("copy", async () => {
    await window.openmind.copyWechatArticle({ html: article.html, text: article.text });
    setNotice("已复制公众号排版，可粘贴到公众号编辑器。");
  });
  const selectCover = () => run("cover", async () => {
    const selected = await window.openmind.chooseWechatCover();
    if (selected) setCover(selected);
  });
  const push = () => run("push", async () => {
    if (!account?.configured) { setAccountOpen(true); return; }
    if (!articleTitle.trim()) throw new Error("请填写文章标题。");
    if (articleTitle.trim().length > WECHAT_TITLE_MAX_LENGTH) throw new Error("标题最多 32 个字，请缩短后发送。");
    if (!cover) throw new Error("请选择文章封面后再发送。");
    await window.openmind.pushWechatDraft({ projectName, outputPath, title: articleTitle.trim(), html: article.html, author: author.trim(), digest: digest.trim(), coverPath: cover.path });
    setSentPayload(payload);
    setNotice("已发送到微信公众号草稿箱，请到公众号后台检查排版。");
  });
  if (!visible) return null;
  const disabled = Boolean(busy) || accountBusy;
  const empty = !markdown.trim() || !article.html || Boolean(article.error);
  return createPortal(
    <div className="project-dialog-backdrop wechat-export-backdrop" data-leaving={leaving || undefined} aria-hidden={leaving || undefined} inert={leaving || undefined} onMouseDown={dismiss}>
      <section ref={dialogRef} className="project-dialog wechat-export-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
        <header>
          <div><h2 id={titleId}>导出到微信公众号</h2><p className="wechat-export-document-title">{title || "未命名文档"}</p></div>
          <button data-motion="action" type="button" className="icon-button" aria-label="关闭公众号导出" disabled={disabled} onClick={dismiss}><X size={16} /></button>
        </header>
        <div className="wechat-export-content">
          <div className="wechat-export-options">
            {draftOpen ? <>
              <button data-motion="action" type="button" className="settings-subtle-action wechat-export-back" disabled={disabled} onClick={() => { setDraftOpen(false); setAccountOpen(false); setError(""); }}><ArrowLeft size={14} />返回排版</button>
              <h3>草稿设置</h3>
              {accountLoading ? <p className="wechat-export-help" role="status">正在加载公众号配置…</p> : null}
              {accountOpen || (!accountLoading && !account?.configured) ? <WechatAccountForm account={account || undefined} onBusyChange={setAccountBusy} onSaved={next => { setAccount(next); setAuthor(next.author); setAccountOpen(false); setAccountError(""); }} onCancel={account?.configured ? () => setAccountOpen(false) : () => setDraftOpen(false)} /> : <>
                {accountError ? <p role="alert" className="wechat-export-error">{accountError}<button data-motion="action" type="button" className="settings-subtle-action" onClick={() => setAccountOpen(true)}>配置公众号</button></p> : null}
                {account?.configured ? <div className="wechat-export-account"><span><Check size={14} />已配置公众号 <small>{account.appId}</small></span><button data-motion="action" type="button" className="icon-button" disabled={disabled} aria-label="编辑公众号配置" onClick={() => setAccountOpen(true)}><Settings2 size={15} /></button></div> : null}
                <label className="project-field"><span>文章标题</span><Input value={articleTitle} maxLength={WECHAT_TITLE_MAX_LENGTH} disabled={disabled} onChange={event => setArticleTitle(event.target.value)} />{articleTitle.length > WECHAT_TITLE_MAX_LENGTH ? <small className="wechat-export-error">标题最多 {WECHAT_TITLE_MAX_LENGTH} 个字，请缩短后发送。</small> : null}</label>
                <div className="project-field"><span>封面</span><button data-motion="action" type="button" className={`wechat-cover-picker${cover ? " has-cover" : ""}`} onClick={() => void selectCover()} disabled={disabled}>{cover ? <img src={cover.previewUrl} alt="文章封面" /> : <ImagePlus size={24} />}<span>{cover ? "更换封面" : "选择 JPG / PNG 图片"}</span></button></div>
                <label className="project-field"><span>作者（选填）</span><Input value={author} maxLength={WECHAT_AUTHOR_MAX_LENGTH} disabled={disabled} placeholder={`最多 ${WECHAT_AUTHOR_MAX_LENGTH} 个字`} onChange={event => setAuthor(event.target.value)} /></label>
                <label className="project-field"><span>摘要（选填）</span><Textarea rows={3} value={digest} maxLength={WECHAT_DIGEST_MAX_LENGTH} disabled={disabled} placeholder="留空由微信从正文提取" onChange={event => setDigest(event.target.value)} /></label>
                <p className="wechat-export-help">发送后可在公众号草稿箱中继续编辑和预览。</p>
              </>}
            </> : <>
              <h3>排版风格</h3>
              <div className="wechat-theme-grid" role="group" aria-label="排版风格">
                {WECHAT_THEMES.map(theme => <button data-motion="action" key={theme.id} type="button" className={`wechat-theme-card${themeId === theme.id ? " active" : ""}`} data-theme={theme.id} aria-pressed={themeId === theme.id} disabled={disabled} style={{ "--wechat-swatch": theme.accentColor } as CSSProperties} onClick={() => { setThemeId(theme.id); setAccentColor(theme.accentColor); setNotice(""); }}>
                  <span className="wechat-theme-sample" aria-hidden="true"><strong>{theme.name}</strong><i /><i /></span>
                  <span className="wechat-theme-caption">{theme.name}{themeId === theme.id ? <Check size={13} /> : null}</span><small>{theme.description}</small>
                </button>)}
              </div>
              <div className="wechat-style-controls">
                <div><h3>主题色</h3><div className="wechat-colors" role="group" aria-label="主题色">{colors.map(color => <button data-motion="selection" key={color.value} type="button" className="wechat-color" style={{ "--wechat-swatch": color.value } as CSSProperties} aria-label={color.name} aria-pressed={accentColor === color.value} disabled={disabled} onClick={() => { setAccentColor(color.value); setNotice(""); }}>{accentColor === color.value ? <Check size={14} /> : null}</button>)}</div></div>
                <label className="project-field wechat-font-size"><span>正文字号</span><select value={fontSize} disabled={disabled} onChange={event => setFontSize(Number(event.target.value))}><option value={14}>14 px</option><option value={16}>16 px</option><option value={18}>18 px</option></select></label>
              </div>
              <p className="wechat-export-help">复制后，在微信公众号编辑器中粘贴即可保留排版。</p>
            </>}
            {article.warnings.length ? <div className="wechat-export-warnings" role="note">{article.warnings.map(warning => <p key={warning}>{warning}</p>)}</div> : null}
          </div>
          <div className="wechat-export-preview"><div className="wechat-preview-label">{WECHAT_THEMES.find(theme => theme.id === themeId)?.name} · 文章预览</div><iframe title="微信公众号排版预览" sandbox="" referrerPolicy="no-referrer" srcDoc={preview} /></div>
        </div>
        <footer className="wechat-export-footer">
          <div className="wechat-export-feedback" aria-live="polite">{error || article.error ? <p className="wechat-export-error" role="alert">{error || article.error}</p> : notice ? <p className="wechat-export-notice" role="status">{notice}{sent ? <button data-motion="action" className="settings-subtle-action" onClick={() => void window.openmind.openExternal("https://mp.weixin.qq.com/").catch(cause => setError(errorText(cause)))}>打开公众号后台</button> : null}</p> : <span className="wechat-export-help">{busy === "push" ? "正在上传图片并发送，请稍候…" : "仅保存为草稿，发布请在公众号后台完成。"}</span>}</div>
          <div className="wechat-export-buttons">
            <button data-motion="action" type="button" className="settings-subtle-action" disabled={disabled || empty || sent || (draftOpen && (accountLoading || accountOpen || !account?.configured))} onClick={() => { if (draftOpen) void push(); else { setDraftOpen(true); setNotice(""); } }}>{busy === "push" ? <LoaderCircle size={15} className="spin" /> : sent ? <Check size={15} /> : <Send size={15} />}{busy === "push" ? "正在发送…" : sent ? "已发送到草稿箱" : "发送到草稿箱"}</button>
            <button data-motion="action" type="button" className="primary-button" disabled={disabled || empty} onClick={() => void copy()}>{busy === "copy" ? <LoaderCircle size={15} className="spin" /> : <Copy size={15} />}{busy === "copy" ? "复制中…" : "复制排版"}</button>
          </div>
        </footer>
      </section>
    </div>, document.body
  );
}

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : "操作失败，请重试。"; }
