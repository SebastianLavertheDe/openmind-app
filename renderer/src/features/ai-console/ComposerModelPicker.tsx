import { useLocale } from "../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, ChevronDown, ChevronRight, ImagePlus, Settings2 } from "lucide-react";
import type { AiSnapshot } from "@shared/contracts";
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
      if (request === revision.current) { setConfiguration(null); setError(cause instanceof Error ? cause.message : uiMessages.interface.imageConfigFailed); }
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

export function ComposerModelPicker({ providers: agents, providerId: agentId, onProviderChange, value, onChange }: {
  providers: AiSnapshot["providers"];
  providerId: string;
  onProviderChange(id: string): void;
  value: ImageSelection | null | undefined;
  onChange(value: ImageSelection | null): void;
}) {
  useLocale();
  const { configuration, error: configurationError, refresh } = useImageConfiguration();
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const providerAnchor = useRef<HTMLButtonElement>(null);
  const [submenuPosition, setSubmenuPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const [submenuSide, setSubmenuSide] = useState("right");
  const id = useId();
  const { exitMs } = useMotionTokens();
  const presence = useExitPresence(open, exitMs);
  const popover = useAnchoredPopover({ open: presence.visible, anchorRef: trigger, floatingRef: menu, preferredSide: "top", align: "end" });
  // Reserve space for the right-hand submenu before hover, so the main menu
  // stays still when a provider opens. Small windows use the available side.
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const menuStyle = { ...popover.style, left: viewportWidth >= 640
    ? Math.min(Number(popover.style.left), viewportWidth - 8 - 288 - 4 - 300)
    : popover.style.left };
  const providers = (configuration?.providers || []).filter(entry => entry.enabled && entry.configured)
    .map(entry => ({ ...entry, models: entry.models.filter(model => IMAGE_PROVIDERS.find(provider => provider.id === entry.provider)?.models.some(item => item.id === model)) }))
    .filter(entry => entry.models.length);
  const requested = value === undefined ? configuration?.defaultSelection : value;
  const matches = requested ? providers.filter(entry => (!requested.providerId || entry.id === requested.providerId) && entry.provider === requested.provider && entry.models.includes(requested.model)) : [];
  const selectedProvider = matches.length === 1 ? matches[0] : undefined;
  const selected = selectedProvider && requested ? { ...requested, providerId: selectedProvider.id } : null;
  const selectedModel = IMAGE_PROVIDERS.find(item => item.id === selected?.provider)?.models.find(item => item.id === selected?.model);
  const activeAgent = agents.find(item => item.id === agentId);
  const activeProvider = providers.find(item => item.id === providerId);
  const submenuOpen = open && Boolean(activeProvider);
  const submenuPresence = useExitPresence(submenuOpen, exitMs);
  const previousProvider = useRef(activeProvider);
  useLayoutEffect(() => { if (activeProvider) previousProvider.current = activeProvider; }, [activeProvider]);
  // Keep the departing surface mounted for its transition, but never expose a
  // removed Provider's models as interactive choices during configuration refresh.
  const visibleProvider = activeProvider || (submenuPresence.visible ? previousProvider.current : undefined);
  const definition = IMAGE_PROVIDERS.find(item => item.id === visibleProvider?.provider);
  const label = [activeAgent?.label, selectedModel?.name].filter(Boolean).join(" · ") || uiMessages.interface.selectModel;
  useEffect(() => {
    if (!configuration) return;
    if (value === undefined || (value && (!selected || value.providerId !== selected.providerId))) onChange(selected);
  }, [configuration, value, selected?.providerId, selected?.model, onChange]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !submenu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    const frame = requestAnimationFrame(() => (menu.current?.querySelector<HTMLButtonElement>("[data-agent][aria-checked=true]") || menu.current?.querySelector<HTMLButtonElement>("button"))?.focus());
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); cancelAnimationFrame(frame); };
  }, [open]);
  useLayoutEffect(() => {
    if (!presence.visible || !activeProvider) return;
    const position = () => {
      if (!providerAnchor.current || !submenu.current || !menu.current) return;
      const anchor = providerAnchor.current.getBoundingClientRect();
      const parent = menu.current.getBoundingClientRect();
      const panel = submenu.current.getBoundingClientRect();
      const width = window.visualViewport?.width || window.innerWidth;
      const height = window.visualViewport?.height || window.innerHeight;
      const padding = 8;
      const gap = 4;
      const rightRoom = width - padding - parent.right - gap;
      const leftRoom = parent.left - padding - gap;
      const side = rightRoom >= panel.width || rightRoom >= leftRoom ? "right" : "left";
      const left = side === "right" ? parent.right + gap : parent.left - gap - panel.width;
      setSubmenuSide(side);
      setSubmenuPosition({
        position: "fixed", visibility: "visible",
        left: Math.max(padding, Math.min(left, width - padding - panel.width)),
        top: Math.max(padding, Math.min(anchor.top - padding, height - padding - panel.height)),
        maxWidth: Math.max(0, width - padding * 2), maxHeight: Math.max(0, height - padding * 2)
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(submenu.current!);
    observer.observe(menu.current!);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [presence.visible, activeProvider?.id, menuStyle.left, menuStyle.top]);
  const choose = async (selection: ImageSelection) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const saved = await window.openmind.selectImageModel(selection);
      onChange(saved.defaultSelection); refresh(); setOpen(false); trigger.current?.focus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : uiMessages.interface.imageModelFailed); refresh(); }
    finally { setBusy(false); }
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>, nested = false) => {
    const panel = nested ? submenu.current : menu.current;
    const items = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "ArrowRight" && !nested && activeProvider) {
      event.preventDefault(); submenu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } else if (nested && ["ArrowLeft", "Escape"].includes(event.key)) {
      event.preventDefault();
      providerAnchor.current?.focus();
      setProviderId("");
    } else if (event.key === "Tab") {
      setOpen(false); trigger.current?.focus();
    }
  };
  return <>
    <div className="chip-select provider-select composer-model-picker" data-open={open || undefined}>
      <button type="button" ref={trigger} className="chip-select-trigger" data-motion="selection" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={uiMessages.interface.selectNamedModel(label)} title={selectedModel ? `${label}（${selectedProvider?.name}）` : label}
        onClick={() => { if (!open) refresh(); setProviderId(""); setError(""); setOpen(current => !current); }}>
        {selectedModel ? <ImagePlus size={15} /> : <Bot size={15} />}<span className="chip-select-value">{label}</span><ChevronDown size={12} className="chip-select-chevron" />
      </button>
    </div>
    {presence.visible ? createPortal(<>
      <div ref={menu} id={id} className="composer-model-menu" role="menu" aria-label={uiMessages.interface.selectModel} style={menuStyle} data-side={popover.side}
        data-leaving={presence.leaving || undefined} inert={!open || undefined} aria-hidden={!open || undefined} onKeyDown={event => navigate(event)}>
        <div className="composer-model-surface">
        <div role="group" aria-label={uiMessages.interface.aiSession} className="composer-model-group">
          <div className="composer-model-heading">{uiMessages.interface.aiSession}</div>
          {agents.map(agent => <button type="button" role="menuitemradio" data-agent={agent.id} data-motion="selection" key={agent.id} aria-checked={agentId === agent.id}
            onMouseEnter={() => setProviderId("")} onFocus={() => setProviderId("")} onClick={() => { onProviderChange(agent.id); setOpen(false); trigger.current?.focus(); }}>
            <Bot size={18} /><span><strong>{agent.label}</strong><small>{agent.detectedModel || (agent.provider === "claude" ? uiMessages.interface.contentTasks : uiMessages.interface.projectTasks)}</small></span>{agentId === agent.id ? <Check size={15} /> : null}
          </button>)}
          {!agents.length ? <p className="image-model-empty">{uiMessages.interface.providerUnavailable}</p> : null}
        </div>
        <div role="group" aria-label={uiMessages.interface.imageGeneration} className="composer-model-group">
          <div className="composer-model-heading">{uiMessages.interface.imageGeneration}</div>
          {providers.map(item => <button type="button" role="menuitem" data-motion="selection" data-provider={item.id} key={item.id}
            ref={activeProvider?.id === item.id ? providerAnchor : undefined} aria-haspopup="menu" aria-expanded={activeProvider?.id === item.id} aria-controls={activeProvider?.id === item.id ? `${id}-images` : undefined}
            onMouseEnter={() => setProviderId(item.id)} onClick={() => setProviderId(item.id)} onFocus={() => setProviderId(item.id)}>
            <ProviderMark provider={item.provider} /><span><strong>{item.name}</strong><small>{uiMessages.interface.imageModelCount(item.models.length)}</small></span>{selected?.providerId === item.id ? <Check size={15} /> : null}<ChevronRight size={13} />
          </button>)}
          {!providers.length ? <p className="image-model-empty">{configuration ? uiMessages.interface.noImageModels : configurationError ? uiMessages.interface.imageModelsFailed : uiMessages.interface.loadingImageModels}</p> : null}
        </div>
        {error || configurationError ? <p className="image-config-error" role="alert">{error || configurationError}</p> : null}
        <div className="image-model-menu-footer">
          <button type="button" role="menuitem" data-motion="action" onMouseEnter={() => setProviderId("")} onFocus={() => setProviderId("")} onClick={() => { setOpen(false); openImageProviderSettings(); }}><Settings2 size={14} />{uiMessages.interface.manageProviders}</button>
        </div>
        </div>
      </div>
      {submenuPresence.visible && visibleProvider && definition ? <div ref={submenu} id={`${id}-images`} className="composer-image-submenu" role="menu" aria-label={uiMessages.interface.providerImageModels(visibleProvider.name)} aria-busy={busy}
        style={submenuPosition} data-side={submenuSide} data-leaving={!submenuOpen || undefined} inert={!submenuOpen || undefined} aria-hidden={!submenuOpen || undefined} onKeyDown={event => navigate(event, true)}>
        <div className="composer-model-surface" key={visibleProvider.id}>
        <div className="composer-model-heading">{visibleProvider.name}</div>
        <div className="image-model-list">
          {definition.models.filter(model => visibleProvider.models.includes(model.id)).map(model => <button type="button" role="menuitemradio" data-motion="selection" key={model.id} aria-checked={selected?.providerId === visibleProvider.id && selected?.model === model.id} disabled={busy || !submenuOpen}
            onClick={() => void choose({ providerId: visibleProvider.id, provider: visibleProvider.provider, model: model.id })}>
            <ImagePlus size={18} /><span><strong>{model.name}</strong><small>{model.description}</small></span>{selected?.providerId === visibleProvider.id && selected?.model === model.id ? <Check size={15} /> : null}
          </button>)}
        </div>
        </div>
      </div> : null}
    </>, document.body) : null}
  </>;
}

function ProviderMark({ provider }: { provider: ImageProviderKind }) {
  useLocale();
  return <span className={`image-provider-mark is-${provider}`} aria-hidden="true">{provider === "volcengine" ? uiMessages.interface.doubaoMark : provider === "openai" ? "O" : "G"}</span>;
}
