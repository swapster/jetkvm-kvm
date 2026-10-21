interface PasteOptions {
  enabled: () => boolean;
  canCapture: () => boolean;
  locked: () => boolean;
  busy: () => boolean;
  resetKeyboard: () => void;
  readClipboard: () => Promise<string>;
  paste: (text: string, signal: AbortSignal) => Promise<void>;
  onError: (reason: "busy" | "text" | Error) => void;
}

/** Keep the browser paste command local until the clipboard write is acknowledged. */
export function attachVideoClipboardPaste(options: PasteOptions) {
  const listeners = new AbortController();
  const suppressed = new Set<string>();
  let transfer: AbortController | undefined;
  let inFlight = false;
  const busy = () => inFlight || options.busy();
  const startTransfer = (read: () => Promise<string>) => {
    inFlight = true;
    transfer = new AbortController();
    const { signal } = transfer;
    options.resetKeyboard();
    // Invoke read synchronously: the locked-shortcut path needs this user activation.
    void read()
      .then(text => options.paste(text, signal))
      .catch((cause: unknown) => {
        if (!signal.aborted)
          options.onError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        inFlight = false;
      });
  };
  const capture = { capture: true, signal: listeners.signal };
  const cancel = () => transfer?.abort();

  document.addEventListener(
    "keydown",
    event => {
      if (!options.enabled()) return;
      const shortcut = event.code === "KeyV" && (event.metaKey || event.ctrlKey) && !event.altKey;
      if (shortcut) {
        // Local inputs retain the browser default, but V never reaches the KVM.
        event.stopImmediatePropagation();
        suppressed.add("KeyV");
        if (!options.canCapture()) return;
        if (event.repeat || busy()) {
          event.preventDefault();
          if (!event.repeat) options.onError("busy");
          return;
        }
        if (event.metaKey) {
          suppressed.add("MetaLeft");
          suppressed.add("MetaRight");
        }
        if (event.ctrlKey) {
          suppressed.add("ControlLeft");
          suppressed.add("ControlRight");
        }
        if (options.locked()) {
          event.preventDefault();
          startTransfer(options.readClipboard);
          return;
        }
        options.resetKeyboard();
        // Do not preventDefault: this keydown must produce a trusted browser paste event.
        return;
      }
      suppressed.delete(event.code);
      if (busy() && options.canCapture()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressed.add(event.code);
      }
    },
    capture,
  );

  document.addEventListener(
    "keyup",
    event => {
      if (suppressed.delete(event.code) || (busy() && options.canCapture())) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    capture,
  );

  document.addEventListener(
    "paste",
    event => {
      if (!event.isTrusted || !options.enabled() || !options.canCapture()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy()) {
        options.onError("busy");
        return;
      }
      if (!event.clipboardData?.types.includes("text/plain")) {
        options.onError("text");
        return;
      }
      const text = event.clipboardData.getData("text/plain");
      startTransfer(() => Promise.resolve(text));
    },
    capture,
  );

  window.addEventListener("blur", cancel, { signal: listeners.signal });
  document.addEventListener("visibilitychange", cancel, { signal: listeners.signal });
  document.addEventListener(
    "focusin",
    () => {
      if (!options.canCapture()) cancel();
    },
    { signal: listeners.signal },
  );
  return () => {
    cancel();
    listeners.abort();
  };
}
