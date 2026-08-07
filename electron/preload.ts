import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/contracts";
import { IPC } from "../shared/ipc-channels";
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
  },
  onSkillRunEvent: (callback) => {
    const listener = (_: unknown, payload: unknown) => callback(payload as never);
    ipcRenderer.on("skill:run-event", listener);
    return () => ipcRenderer.removeListener("skill:run-event", listener);
  },
  onRuntimePackDownloadEvent: (callback) => {
    const listener = (_: unknown, payload: unknown) => callback(payload as never);
    ipcRenderer.on(IPC.APP_RUNTIME_PACK_DOWNLOAD_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC.APP_RUNTIME_PACK_DOWNLOAD_EVENT, listener);
  }
};

contextBridge.exposeInMainWorld("cctools", api);
