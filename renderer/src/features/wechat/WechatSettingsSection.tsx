import { DialogHeader } from "../../design-system/components";
import { Button } from "../../design-system/components";

import { Dialog } from "../../design-system/Dialog";
import { useLocale } from "../../i18n";
import { useEffect, useId, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { messages } from "@shared/messages";
import { useAiUi } from "../../ai-context";
import { StatusBadge } from "../../design-system/components";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useMotionTokens } from "../../design-system/motion-tokens";
import { WechatAccountForm, type WechatAccountView } from "./WechatAccountForm";

const m = messages.wechat.account;

export function WechatSettingsSection() {
  useLocale();
  const ui = useAiUi();
  const [account, setAccount] = useState<WechatAccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formInstance, setFormInstance] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const removingRef = useRef(false);
  const titleId = useId();
  const { exitMs } = useMotionTokens();
  const presence = useExitPresence(editing, exitMs);
  const close = () => { if (!saving) setEditing(false); };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void window.openmind.getWechatAccount().then((view) => { if (active) setAccount(view); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : m.loadFailed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  const disconnect = async () => {
    if (removingRef.current) return;
    removingRef.current = true;
    const recovering = !account;
    try {
      if (!await ui.confirm({ title: m.disconnectTitle, body: m.disconnectBody, confirmText: m.disconnect, danger: true })) return;
      setRemoving(true);
      setError(null);
      await window.openmind.disconnectWechatAccount();
      setAccount({ appId: "", author: "", configured: false });
      if (recovering) { setFormInstance((value) => value + 1); setEditing(true); }
      ui.notify(m.disconnected, "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : m.disconnectFailed);
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  };

  return <>
    <section className="settings-card settings-card--resource" data-entrance-item aria-busy={loading || removing || undefined}>
      <header><div className="settings-card-title"><h2>{m.title}</h2><span>{m.scope}</span></div></header>
      <div className="settings-card-body">
        {loading ? <p className="wechat-account-hint" role="status">{m.loading}</p> : account ? <>
          <div className="settings-resource-row">
            <span className="settings-resource-icon wechat-account-icon"><MessageCircle size={19} aria-hidden /></span>
            <div className="settings-resource-copy"><strong>{m.title}</strong><p>{m.description}</p>{account.configured ? <small>{account.appId}{account.author ? ` · ${account.author}` : ""}</small> : null}</div>
            <div className="settings-resource-actions">
              <StatusBadge tone={account.configured ? "success" : "neutral"}>{account.configured ? m.configured : m.unconfigured}</StatusBadge>
              <Button variant="ghost" type="button"  data-motion="action" ref={triggerRef} disabled={removing} onClick={() => { setFormInstance((value) => value + 1); setEditing(true); }}>{account.configured ? m.edit : m.connect}</Button>
            </div>
          </div>
          {account.configured ? <div className="settings-panel-footer"><span className="wechat-account-hint">{m.storageHint}</span><Button variant="ghost" type="button" className="wechat-account-remove" data-motion="action" disabled={removing} onClick={() => void disconnect()}>{removing ? m.disconnecting : m.disconnect}</Button></div> : null}
        </> : null}
        {removing && !account ? <p className="wechat-account-hint" role="status">{m.disconnecting}</p> : null}
        {error ? <div className="wechat-account-load-error"><p className="wechat-account-error" role="alert">{error}</p>{!account ? <div className="settings-resource-actions">
          <Button variant="ghost" type="button"  data-motion="action" disabled={loading || removing} onClick={() => setLoadAttempt((value) => value + 1)}>{m.retry}</Button>
          <Button variant="ghost" type="button" className="wechat-account-remove" data-motion="action" disabled={loading || removing} onClick={() => void disconnect()}>{m.disconnect}</Button>
        </div> : null}</div> : null}
      </div>
    </section>
    {presence.visible && account ? <Dialog size="lg" as="section" open={editing} presence={presence} triggerRef={triggerRef} onClose={close} dismissDisabled={saving}  containerRef={dialogRef} className="wechat-account-dialog" aria-labelledby={titleId}>
          <DialogHeader title={m.dialogTitle} titleId={titleId} description={m.dialogDescription} onClose={close} closeDisabled={saving} closeLabel={messages.common.close} />
          <WechatAccountForm layout="dialog" key={formInstance} account={account} onBusyChange={setSaving} onCancel={close} onSaved={(next) => { setAccount(next); setEditing(false); ui.notify(m.saved, "success"); }} />
        </Dialog> : null}
  </>;
}
