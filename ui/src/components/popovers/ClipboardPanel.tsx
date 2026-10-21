import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import api from "@/api";
import { CLOUD_API } from "@/ui.config";
import { isInCloud } from "@/main";
import { m } from "@localizations/messages.js";
import { useHidStore, useRTCStore } from "@hooks/stores";
import useKeyboard from "@hooks/useKeyboard";
import { Button, LinkButton } from "@components/Button";
import { GridCard } from "@components/Card";
import PasteModal from "./PasteModal";

const maxClipboardBytes = 64 * 1024;
type ClipboardStatus = { paired: boolean; online: boolean };
type PairingCode = { code: string; expiresAt: string };

async function checkedResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message || m.clipboard_request_failed({ status: response.status }));
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

function NativeClipboard({ deviceId }: { deviceId: string }) {
  const endpoint = `${CLOUD_API}/devices/${encodeURIComponent(deviceId)}/clipboard`;
  const [status, setStatus] = useState<ClipboardStatus | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const isPasteInProgress = useHidStore(state => state.isPasteInProgress);
  const connected = useRTCStore(state => state.peerConnectionState === "connected");
  const { executeMacro } = useKeyboard();
  const executeMacroRef = useRef(executeMacro);
  executeMacroRef.current = executeMacro;

  useEffect(() => {
    const ac = new AbortController();
    controller.current = ac;
    setStatus(null);
    setPairing(null);
    setText("");
    setError("");
    setNotice("");
    busyRef.current = true;
    setBusy(true);
    void api
      .GET(endpoint, { signal: ac.signal })
      .then(checkedResponse<ClipboardStatus>)
      .then(value => {
        if (!ac.signal.aborted) setStatus(value);
      })
      .catch((cause: unknown) => {
        if (!ac.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          busyRef.current = false;
          setBusy(false);
        }
      });
    return () => ac.abort();
  }, [endpoint]);

  // Invoke the operation synchronously so Safari retains the click's clipboard permission.
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    const signal = controller.current?.signal;
    if (busyRef.current || !signal || signal.aborted) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation(signal);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function refresh(signal: AbortSignal) {
    const value = await api.GET(endpoint, { signal }).then(checkedResponse<ClipboardStatus>);
    if (signal.aborted) return;
    setStatus(value);
    if (value.paired) setPairing(null);
  }

  async function copyLocal(value: string, signal: AbortSignal) {
    if (!navigator.clipboard?.writeText) throw new Error(m.clipboard_copy_unavailable());
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      throw new Error(m.clipboard_copy_unavailable());
    }
    if (!signal.aborted) setNotice(m.clipboard_copied());
  }

  async function pasteOnMac(value: string, signal: AbortSignal) {
    if (signal.aborted) return;
    if (new TextEncoder().encode(value).byteLength > maxClipboardBytes) {
      throw new Error(m.clipboard_too_large());
    }
    const result = await api
      .POST(`${endpoint}/write`, { text: value }, { signal })
      .then(checkedResponse<{ ok: boolean }>);
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
    if (useHidStore.getState().isPasteInProgress) {
      throw new Error(m.clipboard_saved_busy());
    }
    await executeMacroRef.current([{ keys: ["KeyV"], modifiers: ["MetaLeft"], delay: 100 }]);
    if (!signal.aborted) setNotice(m.clipboard_paste_sent());
  }

  const unavailable = busy || !status?.paired || !status.online;
  const pasteDisabled = unavailable || !connected || isPasteInProgress;
  const overLimit = new TextEncoder().encode(text).byteLength > maxClipboardBytes;

  return (
    <div className="space-y-3 p-4 text-sm text-slate-700 dark:text-slate-200">
      <p>{m.clipboard_description()}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status">
          {!status
            ? m.clipboard_status_unknown()
            : !status.paired
              ? m.clipboard_not_paired()
              : status.online
                ? m.clipboard_online()
                : m.clipboard_offline()}
        </span>
        <Button
          size="XS"
          theme="light"
          text={m.clipboard_refresh()}
          disabled={busy}
          onClick={() => void run(refresh)}
        />
      </div>
      {status && !status.paired && (
        <div className="space-y-2 rounded-md bg-slate-100 p-3 dark:bg-slate-800">
          <p>{m.clipboard_pair_instructions()}</p>
          <LinkButton
            size="SM"
            theme="light"
            to="/downloads/JetKVM-Clipboard.zip"
            target="_blank"
            text={m.clipboard_download_agent()}
          />
          {pairing && (
            <div className="space-y-2">
              <code className="block text-lg break-all select-text">{pairing.code}</code>
              <p className="text-xs">
                {m.clipboard_code_expires({
                  time: new Date(pairing.expiresAt).toLocaleTimeString(),
                })}
              </p>
              <Button
                size="XS"
                theme="light"
                text={m.clipboard_copy_code()}
                disabled={busy}
                onClick={() => void run(signal => copyLocal(pairing.code, signal))}
              />
            </div>
          )}
          <Button
            size="SM"
            theme="light"
            text={pairing ? m.clipboard_new_code() : m.clipboard_pair()}
            disabled={busy}
            onClick={() =>
              void run(async signal => {
                const value = await api
                  .POST(`${endpoint}/pair`, {}, { signal })
                  .then(checkedResponse<PairingCode>);
                if (!signal.aborted) setPairing(value);
              })
            }
          />
        </div>
      )}
      {status?.paired && !status.online && <p>{m.clipboard_offline_help()}</p>}
      <label className="block space-y-1">
        <span className="font-medium">{m.clipboard_text()}</span>
        <textarea
          ref={textarea}
          value={text}
          onChange={event => {
            setText(event.target.value);
            setError("");
            setNotice("");
          }}
          disabled={busy}
          rows={4}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="block min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white text-base! text-slate-900 select-text dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
      </label>
      {overLimit && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {m.clipboard_too_large()}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="SM"
          theme="light"
          text={m.clipboard_read_mac()}
          disabled={unavailable}
          onClick={() =>
            void run(async signal => {
              const value = await api
                .POST(`${endpoint}/read`, {}, { signal })
                .then(checkedResponse<{ text: string }>);
              if (signal.aborted) return;
              setText(value.text);
              setNotice(m.clipboard_read_done());
            })
          }
        />
        <Button
          size="SM"
          theme="light"
          text={m.clipboard_copy_here()}
          disabled={busy}
          onClick={() => void run(signal => copyLocal(text, signal))}
        />
        <Button
          size="SM"
          theme="light"
          text={m.clipboard_select_text()}
          disabled={busy}
          onClick={() => {
            textarea.current?.focus();
            textarea.current?.select();
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="SM"
          theme="primary"
          text={m.clipboard_paste_local()}
          disabled={pasteDisabled}
          onClick={() =>
            void run(async signal => {
              if (!navigator.clipboard?.readText) throw new Error(m.clipboard_read_unavailable());
              let value: string;
              try {
                value = await navigator.clipboard.readText();
              } catch {
                throw new Error(m.clipboard_read_unavailable());
              }
              if (signal.aborted) return;
              setText(value);
              await pasteOnMac(value, signal);
            })
          }
        />
        <Button
          size="SM"
          theme="light"
          text={m.clipboard_paste_text()}
          disabled={pasteDisabled || overLimit}
          onClick={() => void run(signal => pasteOnMac(text, signal))}
        />
      </div>
      <p className="text-xs">{m.clipboard_limit()}</p>
      {error && (
        <p role="alert" className="break-words text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="break-words">
          {notice}
        </p>
      )}
      {status?.paired && (
        <Button
          size="XS"
          theme="lightDanger"
          text={m.clipboard_unpair()}
          disabled={busy}
          onClick={() =>
            void run(async signal => {
              await api
                .DELETE(`${endpoint}/pair`, undefined, { signal })
                .then(checkedResponse<void>);
              if (signal.aborted) return;
              setStatus({ paired: false, online: false });
              setPairing(null);
              setText("");
            })
          }
        />
      )}
    </div>
  );
}

export default function ClipboardPanel() {
  const { id } = useParams();
  const [native, setNative] = useState(true);
  if (!isInCloud || !id) return <PasteModal />;
  return (
    <div onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <GridCard>
        <div className="flex gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
          <Button
            size="SM"
            theme={native ? "primary" : "light"}
            text={m.clipboard_native()}
            onClick={() => setNative(true)}
          />
          <Button
            size="SM"
            theme={native ? "light" : "primary"}
            text={m.clipboard_keyboard()}
            onClick={() => setNative(false)}
          />
        </div>
        {native ? (
          <NativeClipboard key={id} deviceId={id} />
        ) : (
          <>
            <p className="px-4 pt-3 text-sm text-slate-600 dark:text-slate-300">
              {m.clipboard_keyboard_help()}
            </p>
            <PasteModal />
          </>
        )}
      </GridCard>
    </div>
  );
}
