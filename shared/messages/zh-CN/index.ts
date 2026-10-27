import { rssMessages } from "./rss";
import { skillLibraryMessages } from "./skill-library";
import { coreMessages } from "./core";
import { appMessages } from "./app";
import { electronMessages } from "./electron";
import { featureMessages } from "./features";
import { creativeUiMessages } from "./creative-ui";
import { aiMessages } from "./ai";
import { slashMessages } from "./slash";
import type { TranslationOf } from "../types";
import { editorMessages } from "./editor";
import { interfaceMessages } from "./interface";
import { providerUiMessages } from "./provider-ui";
import { wechatExportMessages } from "./wechat-export";
import { desktopErrorMessages } from "./desktop-errors";
import { validationMessages } from "./validation";
import { browserPreviewMessages } from "./browser-preview";

const { settings: settingsDefaults, brief: briefBackend, ...electronRest } = electronMessages;
const { settings: settingsPage, brief: briefPage, ...featureRest } = featureMessages;

/** Canonical message keys and interpolation signatures for every supported locale. */
export const zhCN = {
  ...rssMessages,
  ...skillLibraryMessages,
  ...editorMessages,
  ...interfaceMessages,
  ...providerUiMessages,
  ...wechatExportMessages,
  ...desktopErrorMessages,
  ...validationMessages,
  ...browserPreviewMessages,
  ...coreMessages,
  ...appMessages,
  ...electronRest,
  ...featureRest,
  settings: { ...settingsDefaults, ...settingsPage },
  brief: { ...briefBackend, ...briefPage },
  creativeUi: creativeUiMessages,
  ai: aiMessages,
  slash: slashMessages
} as const;

export type Messages = TranslationOf<typeof zhCN>;
