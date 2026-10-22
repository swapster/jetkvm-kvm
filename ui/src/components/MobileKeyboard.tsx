import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { FaKeyboard } from "react-icons/fa6";
import { LuChevronDown, LuSend, LuX } from "react-icons/lu";
import { useParams } from "react-router";
import { SplitButtonGroup, SplitButtonPrimary } from "@components/SplitButton";
import useKeyboard, { type MacroStep } from "@hooks/useKeyboard";
import useKeyboardLayout from "@hooks/useKeyboardLayout";
import { useHidStore, useRTCStore, useUiStore } from "@hooks/stores";
import { pasteTextOnMac, useClipboardStore } from "@/nativeClipboard";
import { m } from "@localizations/messages.js";
import notifications from "@/notifications";

const sentinel = "\u200b";
type Mode = "Direct Input" | "Cached Input";

export default function MobileKeyboard() {
  const { id } = useParams();
  const [mode, setMode] = useState<Mode>("Direct Input");
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const transfer = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const queue = useRef(Promise.resolve());
  const connected = useRTCStore(s => s.peerConnectionState === "connected");
  const paired = useClipboardStore(s => !!id && s.devices[id]?.paired);
  const { executeMacro, executeMacroClientSide } = useKeyboard();
  const { selectedKeyboard } = useKeyboardLayout();
  const setFocusTrap = useUiStore(s => s.setDisableVideoFocusTrap);

  function close() {
    generation.current++;
    transfer.current?.abort();
    input.current?.blur();
    setOpen(false);
    setMenu(false);
    setFocusTrap(false);
  }

  function show(next: Mode) {
    generation.current++;
    transfer.current?.abort();
    composing.current = false;
    // iOS requires focus during the original tap, not in a later effect.
    flushSync(() => {
      setMode(next);
      setMenu(false);
      setOpen(true);
      setFocusTrap(true);
      useHidStore.getState().setVirtualKeyboardEnabled(false);
    });
    if (input.current) {
      input.current.value = next === "Direct Input" ? sentinel : draft;
      input.current.focus({ preventScroll: true });
      input.current.setSelectionRange(input.current.value.length, input.current.value.length);
    }
  }

  useEffect(
    () => () => {
      generation.current++;
      transfer.current?.abort();
      setFocusTrap(false);
    },
    [id, setFocusTrap],
  );

  useEffect(() => {
    if (!connected) {
      generation.current++;
      transfer.current?.abort();
      input.current?.blur();
      setOpen(false);
      setFocusTrap(false);
    }
  }, [connected, setFocusTrap]);

  function enqueue(steps: MacroStep[]) {
    const epoch = generation.current;
    queue.current = queue.current
      .then(async () => {
        if (
          epoch !== generation.current ||
          useRTCStore.getState().peerConnectionState !== "connected"
        )
          return;
        if (useClipboardStore.getState().pasting || useHidStore.getState().isPasteInProgress) {
          throw new Error(m.clipboard_busy());
        }
        // Device-side macros cancel their predecessor and return before completion.
        for (const step of steps) {
          if (epoch !== generation.current) return;
          await executeMacroClientSide([step]);
        }
      })
      .catch((error: unknown) => {
        generation.current++;
        notifications.error(error instanceof Error ? error.message : String(error));
      });
  }

  function directText(text: string) {
    const steps: MacroStep[] = [];
    for (const char of text.normalize("NFC")) {
      const key = selectedKeyboard.chars[char];
      if (!key) {
        notifications.error(m.mobile_keyboard_unsupported());
        return;
      }
      for (const part of [key.accentKey, key]) {
        if (!part) continue;
        steps.push({
          keys: [String(part.key)],
          modifiers: [...(part.shift ? ["ShiftLeft"] : []), ...(part.altRight ? ["AltRight"] : [])],
          delay: 20,
        });
      }
      if (key.deadKey) steps.push({ keys: ["Space"], modifiers: [], delay: 20 });
    }
    if (steps.length) enqueue(steps);
  }

  function consumeInput() {
    const element = input.current;
    if (!element || composing.current) return;
    const text = element.value.replace(sentinel, "");
    element.value = sentinel;
    element.setSelectionRange(1, 1);
    if (text) directText(text);
  }

  async function sendDraft() {
    if (!id || transfer.current || !draft) return;
    const ac = new AbortController();
    transfer.current = ac;
    setSending(true);
    try {
      await pasteTextOnMac(id, draft, ac.signal, executeMacro);
      if (!ac.signal.aborted) {
        setDraft("");
        if (input.current) input.current.value = "";
      }
    } catch (error) {
      if (!ac.signal.aborted)
        notifications.error(error instanceof Error ? error.message : String(error));
    } finally {
      transfer.current = null;
      setSending(false);
    }
  }

  return (
    <>
      <SplitButtonGroup>
        <SplitButtonPrimary
          icon={FaKeyboard}
          label={m.action_bar_virtual_keyboard()}
          disabled={!connected}
          aria-expanded={open}
          aria-pressed={open}
          onMouseDown={e => e.preventDefault()}
          onClick={() => (open ? close() : show(mode))}
        />
        <button
          type="button"
          aria-label={m.mobile_keyboard_mode()}
          aria-expanded={menu}
          className="rounded-r-sm border border-slate-500/30 bg-white px-2 dark:bg-slate-800"
          onMouseDown={e => e.preventDefault()}
          onClick={() => setMenu(!menu)}
        >
          <LuChevronDown className="h-4 w-4" />
        </button>
      </SplitButtonGroup>
      {(menu || open) &&
        createPortal(
          <section
            className="mobile-touch-controls fixed top-32 right-2 left-2 z-30 max-h-[calc(100dvh-9rem)] overflow-auto rounded-lg border border-slate-500/30 bg-white p-3 text-slate-900 shadow-lg dark:bg-slate-800 dark:text-white"
            onKeyDown={e => {
              e.stopPropagation();
              if (
                mode !== "Direct Input" ||
                composing.current ||
                e.nativeEvent.isComposing ||
                e.target !== input.current
              )
                return;
              const key = { Enter: "Enter", Backspace: "Backspace", Tab: "Tab" }[e.key];
              if (key) {
                e.preventDefault();
                enqueue([{ keys: [key], modifiers: [], delay: 20 }]);
              }
            }}
            onKeyUp={e => e.stopPropagation()}
          >
            {menu && (
              <div className="mb-2 flex gap-2">
                {(["Direct Input", "Cached Input"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    disabled={!connected || (value === "Cached Input" && !paired)}
                    aria-pressed={mode === value}
                    className="rounded border border-slate-500/30 px-3 disabled:opacity-40"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => show(value)}
                  >
                    {value}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={m.mobile_keyboard_close()}
                  onClick={() => setMenu(false)}
                >
                  <LuX />
                </button>
              </div>
            )}
            {open && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <strong>{mode}</strong>
                  <button
                    type="button"
                    aria-label={m.mobile_keyboard_close()}
                    onMouseDown={e => e.preventDefault()}
                    onClick={close}
                  >
                    <LuX />
                  </button>
                </div>
                <textarea
                  ref={input}
                  aria-label={mode}
                  rows={mode === "Direct Input" ? 1 : 3}
                  className="w-full resize-none rounded border border-slate-500/30 bg-transparent p-2 text-base"
                  defaultValue={mode === "Direct Input" ? sentinel : draft}
                  readOnly={sending}
                  autoCapitalize={mode === "Direct Input" ? "none" : "sentences"}
                  autoCorrect={mode === "Direct Input" ? "off" : "on"}
                  spellCheck={mode === "Cached Input"}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                    if (mode === "Direct Input") consumeInput();
                  }}
                  onBeforeInput={e => {
                    if (mode !== "Direct Input" || composing.current) return;
                    const type = (e.nativeEvent as InputEvent).inputType;
                    if (
                      type === "deleteContentBackward" ||
                      type === "insertParagraph" ||
                      type === "insertLineBreak"
                    ) {
                      e.preventDefault();
                      enqueue([
                        {
                          keys: [type === "deleteContentBackward" ? "Backspace" : "Enter"],
                          modifiers: [],
                          delay: 20,
                        },
                      ]);
                    }
                  }}
                  onInput={e => {
                    if (mode === "Cached Input") setDraft(e.currentTarget.value);
                    else if (!composing.current) {
                      if (
                        (e.nativeEvent as InputEvent).inputType === "deleteContentBackward" &&
                        !e.currentTarget.value
                      ) {
                        enqueue([{ keys: ["Backspace"], modifiers: [], delay: 20 }]);
                      }
                      consumeInput();
                    }
                  }}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                  {mode === "Direct Input"
                    ? m.mobile_keyboard_direct_help({ layout: selectedKeyboard.name })
                    : m.mobile_keyboard_cached_help()}
                </p>
                {mode === "Cached Input" && (
                  <button
                    type="button"
                    disabled={sending || !draft || !paired}
                    className="mt-2 flex items-center gap-2 rounded bg-blue-700 px-3 text-white disabled:opacity-40"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => void sendDraft()}
                  >
                    <LuSend />
                    {m.mobile_keyboard_send()}
                  </button>
                )}
              </>
            )}
          </section>,
          document.body,
        )}
    </>
  );
}
