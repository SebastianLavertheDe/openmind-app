import { coreMessages } from "./core";
import { appMessages } from "./app";
import { electronMessages } from "./electron";
import { featureMessages } from "./features";
import { creativeUiMessages } from "./creative-ui";
import { aiMessages } from "./ai";
import { slashMessages } from "./slash";
import { browserPreviewMessages } from "./browser-preview";

const { settings: settingsDefaults, brief: briefBackend, ...electronRest } = electronMessages;
const { settings: settingsPage, brief: briefPage, ...featureRest } = featureMessages;

/** 当前默认 locale 的全部 UI / 交互文案（不做 i18n 框架，集中维护于此）。 */
export const zhCN = {
  ...coreMessages,
  ...appMessages,
  ...electronRest,
  ...featureRest,
  settings: { ...settingsDefaults, ...settingsPage },
  brief: { ...briefBackend, ...briefPage },
  creativeUi: creativeUiMessages,
  ai: aiMessages,
  slash: slashMessages,
  browserPreview: browserPreviewMessages
} as const;

export type Messages = typeof zhCN;
