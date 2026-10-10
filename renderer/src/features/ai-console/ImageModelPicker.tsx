import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, ImagePlus, Settings2 } from "lucide-react";
import { IMAGE_PROVIDERS, type ImageConfiguration, type ImageProviderKind, type ImageSelection } from "@shared/image-generation";
import { useAnchoredPopover } from "../../design-system/use-anchored-popover";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useMotionTokens } from "../../design-system/motion-tokens";
import { PROVIDER_CONFIGURATION_CHANGED, openImageProviderSettings } from "../../provider-configuration-events";

function useImageConfiguration() {
  const [configuration, setConfiguration] = useState<ImageConfiguration | null>(null);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const refresh = useCallback(() => {
    const request = ++revision.current;
    void window.openmind.getImageConfiguration?.().then(value => {
      if (request === revision.current) { setConfiguration(value); setError(""); }
    }).catch(cause => {
      if (request === revision.current) { setConfiguration(null); setError(cause instanceof Error ? cause.message : "图片配置加载失败"); }
    });
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(PROVIDER_CONFIGURATION_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => { revision.current++; window.removeEventListener(PROVIDER_CONFIGURATION_CHANGED, refresh); window.removeEventListener("focus", refresh); };
  }, [refresh]);
  return { configuration, error, refresh };
}

export function ImageModelPicker({ value, onChange }: { value: ImageSelection | null | undefined; onChange(value: ImageSelection | null): void }) {
  const { configuration, error: configurationError, refresh } = useImageConfiguration();
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const { exitMs } = useMotionTokens();
  const presence = useExitPresence(open, exitMs);
  const popover = useAnchoredPopover({ open: presence.visible, anchorRef: trigger, floatingRef: menu, preferredSide: "top", align: "end" });
  const providers = (configuration?.providers || []).filter(entry => entry.enabled && entry.configured)
    .map(entry => ({ ...entry, models: entry.models.filter(model => IMAGE_PROVIDERS.find(provider => provider.id === entry.provider)?.models.some(item => item.id === model)) }))
    .filter(entry => entry.models.length);
  const requested = value === undefined ? configuration?.defaultSelection : value;
  const matches = requested ? providers.filter(entry => (!requested.providerId || entry.id === requested.providerId) && entry.provider === requested.provider && entry.models.includes(requested.model)) : [];
  const selectedProvider = matches.length === 1 ? matches[0] : undefined;
  const selected = selectedProvider && requested ? { ...requested, providerId: selectedProvider.id } : null;
  const selectedModel = IMAGE_PROVIDERS.find(item => item.id === selected?.provider)?.models.find(item => item.id === selected?.model);
  const activeProvider = providers.find(item => item.id === providerId) || selectedProvider || providers[0];
  const definition = IMAGE_PROVIDERS.find(item => item.id === activeProvider?.provider);
  useEffect(() => {
    if (!configuration) return;
    if (value === undefined || (value && (!selected || value.providerId !== selected.providerId))) onChange(selected);
  }, [configuration, value, selected?.providerId, selected?.model, onChange]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    const frame = requestAnimationFrame(() => (menu.current?.querySelector<HTMLButtonElement>("[data-provider][aria-pressed=true]") || menu.current?.querySelector<HTMLButtonElement>("button"))?.focus());
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); cancelAnimationFrame(frame); };
  }, [open]);
  const choose = async (selection: ImageSelection | null) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const saved = await window.openmind.selectImageModel(selection);
      onChange(saved.defaultSelection); refresh(); setOpen(false); trigger.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片模型选择失败"); refresh(); }
    finally { setBusy(false); }
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "ArrowRight") {
      event.preventDefault(); menu.current?.querySelector<HTMLButtonElement>("[role=option]")?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault(); menu.current?.querySelector<HTMLButtonElement>("[data-provider][aria-pressed=true]")?.focus();
    } else if (event.key === "Tab" && (event.shiftKey ? current === 0 : current === items.length - 1)) {
      setOpen(false); trigger.current?.focus();
    }
  };
  return <>
    <div className="chip-select image-model-picker" data-open={open || undefined}>
      <button type="button" ref={trigger} className="chip-select-trigger" data-motion="selection" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={`图片模型：${selectedModel?.name || "未选择"}`} title={selectedModel ? `${selectedProvider?.name} · ${selectedModel.name}` : "选择图片服务商和模型"}
        onClick={() => { if (!open) refresh(); setProviderId(selected?.providerId || ""); setError(""); setOpen(current => !current); }}>
        <ImagePlus size={15} /><span className="image-model-label">{selectedModel?.name || "图片模型"}</span><ChevronDown size={12} className="chip-select-chevron" />
      </button>
    </div>
    {presence.visible ? createPortal(<div ref={menu} id={id} className="image-model-menu" role="dialog" aria-label="选择图片模型" style={popover.style} data-side={popover.side}
      data-leaving={presence.leaving || undefined} inert={!open || undefined} aria-hidden={!open || undefined} onKeyDown={navigate}>
      <div className="image-model-menu-heading"><strong>图片模型</strong><span>仅显示已启用的生图模型</span></div>
      {activeProvider && definition ? <div className="image-model-columns">
        <div className="image-provider-list" aria-label="图片服务商">
          {providers.map(item => <button type="button" data-motion="selection" data-provider={item.id} key={item.id} aria-pressed={activeProvider.id === item.id}
            onClick={() => setProviderId(item.id)} onFocus={() => setProviderId(item.id)}><ProviderMark provider={item.provider} /><span>{item.name}</span><ChevronRight size={13} /></button>)}
        </div>
        <div className="image-model-list" role="listbox" aria-label={`${activeProvider.name} 图片模型`} aria-busy={busy}>
          {definition.models.filter(model => activeProvider.models.includes(model.id)).map(model => <button type="button" role="option" data-motion="selection" key={model.id} aria-selected={selected?.providerId === activeProvider.id && selected?.model === model.id} disabled={busy}
            onClick={() => void choose({ providerId: activeProvider.id, provider: activeProvider.provider, model: model.id })}>
            <span><strong>{model.name}</strong><small>{model.description}</small></span>{selected?.providerId === activeProvider.id && selected?.model === model.id ? <Check size={15} /> : null}
          </button>)}
        </div>
      </div> : <p className="image-model-empty">{configuration ? "暂无可用的图片模型。请在 Provider 配置中开启「支持图片生成」并选择模型。" : configurationError ? "无法读取图片模型配置，请检查 Provider 配置后重试。" : "正在读取图片模型…"}</p>}
      {error || configurationError ? <p className="image-config-error" role="alert">{error || configurationError}</p> : null}
      <div className="image-model-menu-footer">
        <button type="button" data-motion="action" onClick={() => { setOpen(false); openImageProviderSettings(); }}><Settings2 size={14} />管理 Provider</button>
        {selected ? <button type="button" data-motion="action" disabled={busy} onClick={() => void choose(null)}>关闭生图</button> : null}
      </div>
    </div>, document.body) : null}
  </>;
}

function ProviderMark({ provider }: { provider: ImageProviderKind }) {
  return <span className={`image-provider-mark is-${provider}`} aria-hidden="true">{provider === "volcengine" ? "豆" : provider === "openai" ? "O" : "G"}</span>;
}
