import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/contracts";
import { createDesktopInvokeBridge } from "../shared/ipc-bridge";

const invokeBridge = createDesktopInvokeBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args));

const api: DesktopApi = {
  ...invokeBridge,
  onAiEvent: (callback) => {
    const listener = (_: unknown, payload: unknown) => callback(payload as never);
    ipcRenderer.on("ai:push", listener);
    return () => ipcRenderer.removeListener("ai:push", listener);
  },
  onSkillEvent: (callback) => {
    const output = (_: unknown, payload: unknown) => callback(payload as Record<string, unknown>);
    const status = (_: unknown, payload: unknown) => callback(payload as Record<string, unknown>);
    ipcRenderer.on("skill:output", output);
    ipcRenderer.on("skill:status", status);
    return () => {
      ipcRenderer.removeListener("skill:output", output);
      ipcRenderer.removeListener("skill:status", status);
    };
  }
};

contextBridge.exposeInMainWorld("cctools", api);
