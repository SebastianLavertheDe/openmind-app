import { useLocale } from "../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { IMAGE_PROVIDERS, type ImageCapability } from "@shared/image-generation";
import { Select, ToggleSwitch } from "../../design-system/components";

export function defaultImageCapability(baseUrl: string): ImageCapability {
  let host = "";
  try { host = new URL(baseUrl).hostname; } catch { /* Custom connection, choose its image API below. */ }
  const provider = IMAGE_PROVIDERS.find(entry => new URL(entry.baseUrl).hostname === host) || IMAGE_PROVIDERS[1];
  return { provider: provider.id, models: [provider.models[0].id] };
}

export function ProviderImageCapability({ value, baseUrl, disabled, onChange }: {
  value: ImageCapability | null | undefined; baseUrl: string; disabled?: boolean; onChange(value: ImageCapability | null): void;
}) {
  useLocale();
  const definition = IMAGE_PROVIDERS.find(entry => entry.id === value?.provider);
  return <div className="settings-provider-image-capability">
    <div className="settings-provider-image-heading">
      <div><strong>{uiMessages.interface.supportsImages}</strong><p>{uiMessages.interface.sharedImageCredentials}</p></div>
      <ToggleSwitch checked={Boolean(value)} label={uiMessages.interface.supportsImages} disabled={disabled} onChange={checked => onChange(checked ? defaultImageCapability(baseUrl) : null)} />
    </div>
    {value && definition ? <div className="settings-provider-image-fields">
      <div className="settings-field"><span>{uiMessages.interface.imageServiceType}</span>
        <Select className="settings-select" size="rect" ariaLabel={uiMessages.interface.imageServiceType}
          value={value.provider} disabled={disabled}
          options={IMAGE_PROVIDERS.map(provider => ({ value: provider.id, label: provider.name }))}
          onChange={providerId => {
            const provider = IMAGE_PROVIDERS.find(entry => entry.id === providerId)!;
            onChange({ provider: provider.id, models: [provider.models[0].id] });
          }} />
      </div>
      <fieldset disabled={disabled} className="settings-provider-image-models"><legend>{uiMessages.interface.availableImageModels}</legend>
        {definition.models.map(model => <label key={model.id}>
          <input type="checkbox" checked={value.models.includes(model.id)} onChange={event => onChange({ ...value, models: event.target.checked ? [...value.models, model.id] : value.models.filter(id => id !== model.id) })} />
          <span><strong>{model.name}</strong><small>{model.description}</small></span>
        </label>)}
      </fieldset>
      <p className="settings-note">{uiMessages.interface.imageModelHint}</p>
      {!value.models.length ? <p className="image-config-error" role="alert">{uiMessages.interface.selectImageModel}</p> : null}
    </div> : null}
  </div>;
}
