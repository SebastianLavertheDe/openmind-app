import { IMAGE_PROVIDERS, type ImageCapability } from "@shared/image-generation";
import { ToggleSwitch } from "../../design-system/components";

export function defaultImageCapability(baseUrl: string): ImageCapability {
  let host = "";
  try { host = new URL(baseUrl).hostname; } catch { /* Custom connection, choose its image API below. */ }
  const provider = IMAGE_PROVIDERS.find(entry => new URL(entry.baseUrl).hostname === host) || IMAGE_PROVIDERS[1];
  return { provider: provider.id, models: [provider.models[0].id] };
}

export function ProviderImageCapability({ value, baseUrl, disabled, onChange }: {
  value: ImageCapability | null | undefined; baseUrl: string; disabled?: boolean; onChange(value: ImageCapability | null): void;
}) {
  const definition = IMAGE_PROVIDERS.find(entry => entry.id === value?.provider);
  return <div className="settings-provider-image-capability">
    <div className="settings-provider-image-heading">
      <div><strong>支持图片生成</strong><p>与文本对话共用此 Provider 的地址和 API Key。</p></div>
      <ToggleSwitch checked={Boolean(value)} label="支持图片生成" disabled={disabled} onChange={checked => onChange(checked ? defaultImageCapability(baseUrl) : null)} />
    </div>
    {value && definition ? <div className="settings-provider-image-fields">
      <label className="settings-field"><span>图片服务类型</span>
        <select className="settings-select" value={value.provider} disabled={disabled} data-motion="selection" onChange={event => {
          const provider = IMAGE_PROVIDERS.find(entry => entry.id === event.target.value)!;
          onChange({ provider: provider.id, models: [provider.models[0].id] });
        }}>{IMAGE_PROVIDERS.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
      </label>
      <fieldset disabled={disabled} className="settings-provider-image-models"><legend>可用的图片模型</legend>
        {definition.models.map(model => <label key={model.id}>
          <input type="checkbox" checked={value.models.includes(model.id)} onChange={event => onChange({ ...value, models: event.target.checked ? [...value.models, model.id] : value.models.filter(id => id !== model.id) })} />
          <span><strong>{model.name}</strong><small>{model.description}</small></span>
        </label>)}
      </fieldset>
      <p className="settings-note">仅勾选的图片生成模型会出现在聊天图片菜单中。支持识图的文本模型不属于生图模型。</p>
      {!value.models.length ? <p className="image-config-error" role="alert">请至少选择一个图片模型，或关闭图片生成。</p> : null}
    </div> : null}
  </div>;
}
