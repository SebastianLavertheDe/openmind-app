export const PROVIDER_CONFIGURATION_CHANGED = "openmind:provider-configuration-changed";
export const OPEN_IMAGE_PROVIDER_SETTINGS = "openmind:open-image-provider-settings";

export function announceProviderConfiguration() { window.dispatchEvent(new Event(PROVIDER_CONFIGURATION_CHANGED)); }
export function openImageProviderSettings() { window.dispatchEvent(new Event(OPEN_IMAGE_PROVIDER_SETTINGS)); }
