import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Info, ShieldCheck } from "lucide-react";
import { WECHAT_AUTHOR_MAX_LENGTH, WechatAccountInputSchema, type WechatAccountView } from "@shared/wechat";
import { messages } from "@shared/messages";
import "../../styles/features/wechat-account.css";

const m = messages.wechat.account;

export type { WechatAccountView } from "@shared/wechat";

export type WechatAccountFormProps = {
  account?: WechatAccountView;
  onSaved(account: WechatAccountView): void;
  onCancel?(): void;
  onBusyChange?(busy: boolean): void;
};

/** Shared by settings and the article export dialog; secrets are never loaded. */
export function WechatAccountForm({ account, onSaved, onCancel, onBusyChange }: WechatAccountFormProps) {
  const [loadedAccount, setLoadedAccount] = useState<WechatAccountView | null>(account ?? null);
  const [appId, setAppId] = useState(account?.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [author, setAuthor] = useState(account?.author ?? "");
  const [loading, setLoading] = useState(!account);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const pending = useRef(false);
  const prefix = useId();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (account ? Promise.resolve(account) : window.openmind.getWechatAccount()).then((view) => {
      if (!active) return;
      setLoadedAccount(view);
      setAppId(view.appId);
      setAuthor(view.author);
      setAppSecret("");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : m.loadFailed);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, loadAttempt]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || !loadedAccount) return;
    const nextAppId = appId.trim();
    const nextSecret = appSecret.trim();
    if (!nextAppId) { setError(m.appIdRequired); return; }
    if (!nextSecret && !loadedAccount.configured) { setError(m.secretRequired); return; }
    if (!nextSecret && nextAppId !== loadedAccount.appId) { setError(m.changedAppIdSecretRequired); return; }
    const input = WechatAccountInputSchema.safeParse({ appId: nextAppId, author: author.trim(), ...(nextSecret ? { appSecret: nextSecret } : {}) });
    if (!input.success) { setError(input.error.issues[0]?.message || m.saveFailed); return; }
    pending.current = true;
    setSaving(true);
    setError(null);
    onBusyChange?.(true);
    try {
      const saved = await window.openmind.saveWechatAccount(input.data);
      setAppSecret("");
      setLoadedAccount(saved);
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : m.saveFailed);
    } finally {
      pending.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  };

  const openConsole = async () => {
    try { await window.openmind.openExternal("https://mp.weixin.qq.com/"); }
    catch { setError(m.openConsoleFailed); }
  };

  return (
    <form className="wechat-account-form" onSubmit={(event) => void save(event)} aria-busy={loading || saving || undefined}>
      <div className="wechat-account-form-body">
        {loading ? <p role="status">{m.loading}</p> : null}
        {!loading && !loadedAccount ? (
          <div className="wechat-account-load-error">
            <p role="alert">{error || m.loadFailed}</p>
            <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => setLoadAttempt((value) => value + 1)}>{m.retry}</button>
          </div>
        ) : null}
        {!loading && loadedAccount ? <>
          <div className="wechat-account-notice">
            <Info size={16} aria-hidden />
            <div><p>{m.whitelistHint}</p><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void openConsole()}>{m.openConsole}<ExternalLink size={13} aria-hidden /></button></div>
          </div>
          <label className="settings-field" htmlFor={`${prefix}-appid`}>
            <span>{m.appId}</span>
            <input id={`${prefix}-appid`} className="settings-browser-path-input" value={appId} placeholder={m.appIdPlaceholder} autoComplete="off" spellCheck={false} disabled={saving} onChange={(event) => setAppId(event.target.value)} />
          </label>
          <label className="settings-field" htmlFor={`${prefix}-secret`}>
            <span>{m.appSecret}</span>
            <input id={`${prefix}-secret`} className="settings-browser-path-input" type="password" value={appSecret} placeholder={loadedAccount.configured ? m.secretKeepPlaceholder : m.secretPlaceholder} autoComplete="new-password" spellCheck={false} disabled={saving} onChange={(event) => setAppSecret(event.target.value)} />
          </label>
          <label className="settings-field" htmlFor={`${prefix}-author`}>
            <span>{m.author}</span>
            <input id={`${prefix}-author`} className="settings-browser-path-input" value={author} placeholder={m.authorPlaceholder} maxLength={WECHAT_AUTHOR_MAX_LENGTH} disabled={saving} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          <p className="wechat-account-hint">{m.verificationHint}</p>
          {error ? <p className="wechat-account-error" role="alert">{error}</p> : null}
        </> : null}
      </div>
      <footer className="wechat-account-form-footer">
        <span className="wechat-account-storage-hint"><ShieldCheck size={14} aria-hidden />{m.storageHint}</span>
        <div>
          {onCancel ? <button type="button" className="settings-subtle-action" data-motion="action" disabled={saving} onClick={onCancel}>{m.cancel}</button> : null}
          <button type="submit" className="primary-button" data-motion="action" disabled={loading || saving || !loadedAccount}>{saving ? m.saving : m.save}</button>
        </div>
      </footer>
    </form>
  );
}
