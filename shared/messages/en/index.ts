import { skillLibraryMessages } from "./skill-library";
import { coreMessages } from "./core";
import { appMessages } from "./app";
import { electronMessages } from "./electron";
import { featureMessages } from "./features";
import { creativeUiMessages } from "./creative-ui";
import { aiMessages } from "./ai";
import { slashMessages } from "./slash";
import type { Messages } from "../zh-CN";
import { editorMessages } from "./editor";
import { interfaceMessages } from "./interface";
import { providerUiMessages } from "./provider-ui";
import { wechatExportMessages } from "./wechat-export";
import { desktopErrorMessages } from "./desktop-errors";
import { validationMessages } from "./validation";
import { browserPreviewMessages } from "./browser-preview";

const { settings: settingsDefaults, brief: briefBackend, ...electronRest } = electronMessages;
const { settings: settingsPage, brief: briefPage, ...featureRest } = featureMessages;

export const en: Messages = {
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
};
