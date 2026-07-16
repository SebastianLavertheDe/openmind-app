import type { DesktopApi } from "./contracts";
import { IPC_INVOKE_REGISTRY, type IpcInvokeMethod } from "./ipc-registry";

/** 从 IPC_INVOKE_REGISTRY 派生 preload DesktopApi invoke 桥（E3 完整表）。 */
export function createDesktopInvokeBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
): Pick<DesktopApi, IpcInvokeMethod> {
  const bridge = {} as Record<IpcInvokeMethod, (...args: unknown[]) => Promise<unknown>>;
  for (const { method, channel } of IPC_INVOKE_REGISTRY) {
    bridge[method] = (...args: unknown[]) => invoke(channel, ...args);
  }
  return bridge as Pick<DesktopApi, IpcInvokeMethod>;
}
