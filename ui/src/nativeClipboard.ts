import { create } from "zustand";

import api from "@/api";
import { CLOUD_API } from "@/ui.config";
import { m } from "@localizations/messages.js";
import { useHidStore, useRTCStore } from "@hooks/stores";
import type { MacroSteps } from "@hooks/useKeyboard";

export const maxClipboardBytes = 64 * 1024;
export type ClipboardStatus = { paired: boolean; online: boolean };

export const useClipboardStore = create<{
  devices: Record<string, ClipboardStatus>;
  pasting: boolean;
}>(() => ({ devices: {}, pasting: false }));

export function setClipboardStatus(deviceId: string, status: ClipboardStatus) {
  useClipboardStore.setState(state => ({ devices: { ...state.devices, [deviceId]: status } }));
}

export function clipboardEndpoint(deviceId: string) {
  return `${CLOUD_API}/devices/${encodeURIComponent(deviceId)}/clipboard`;
}

export async function checkedClipboardResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message || m.clipboard_request_failed({ status: response.status }));
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export async function loadClipboardStatus(deviceId: string, signal: AbortSignal) {
  const status = await api
    .GET(clipboardEndpoint(deviceId), { signal })
    .then(checkedClipboardResponse<ClipboardStatus>);
  if (!signal.aborted) setClipboardStatus(deviceId, status);
  return status;
}

export async function pasteTextOnMac(
  deviceId: string,
  text: string,
  signal: AbortSignal,
  executeMacro: (steps: MacroSteps) => Promise<void>,
) {
  if (signal.aborted) return;
  if (useClipboardStore.getState().pasting) throw new Error(m.clipboard_busy());
  if (new TextEncoder().encode(text).byteLength > maxClipboardBytes) {
    throw new Error(m.clipboard_too_large());
  }
  useClipboardStore.setState({ pasting: true });
  try {
    const result = await api
      .POST(`${clipboardEndpoint(deviceId)}/write`, { text }, { signal })
      .then(checkedClipboardResponse<{ ok: boolean }>);
    if (signal.aborted) return;
    if (!result.ok) throw new Error(m.clipboard_write_failed());
    const rtc = useRTCStore.getState();
    const hidReady =
      !rtc.hidRpcDisabled &&
      rtc.rpcHidChannel?.readyState === "open" &&
      rtc.rpcHidProtocolVersion !== null;
    if (
      rtc.peerConnectionState !== "connected" ||
      (!hidReady && rtc.rpcDataChannel?.readyState !== "open")
    ) {
      throw new Error(m.clipboard_saved_disconnected());
    }
    if (useHidStore.getState().isPasteInProgress) throw new Error(m.clipboard_saved_busy());
    await executeMacro([{ keys: ["KeyV"], modifiers: ["MetaLeft"], delay: 100 }]);
  } finally {
    useClipboardStore.setState({ pasting: false });
  }
}

// Invoke directly from a click or keydown handler, before any asynchronous work.
export async function readLocalClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error(m.clipboard_read_unavailable());
  try {
    return await navigator.clipboard.readText();
  } catch {
    throw new Error(m.clipboard_read_unavailable());
  }
}
