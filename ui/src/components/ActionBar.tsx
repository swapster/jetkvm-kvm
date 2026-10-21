import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { MdOutlineContentPasteGo } from "react-icons/md";
import {
  LuCable,
  LuExternalLink,
  LuHardDrive,
  LuMaximize,
  LuScanText,
  LuSettings,
  LuSignal,
  LuTerminal,
  LuX,
} from "react-icons/lu";
import { FaKeyboard } from "react-icons/fa6";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { CommandLineIcon } from "@heroicons/react/20/solid";
import { useParams } from "react-router";
import { isInCloud } from "@/main";
import { pasteTextOnMac, readLocalClipboard, useClipboardStore } from "@/nativeClipboard";
import useKeyboard from "@hooks/useKeyboard";
import notifications from "@/notifications";

import { SplitButtonGroup, SplitButtonPrimary, SplitButtonCaret } from "@components/SplitButton";

import { cx } from "@/cva.config";
import {
  useHidStore,
  useMountMediaStore,
  useSettingsStore,
  useUiStore,
  useVideoStore,
} from "@hooks/stores";
import { useDeviceUiNavigation } from "@hooks/useAppNavigation";
import { Button } from "@components/Button";
import Container from "@components/Container";
import ClipboardPanel from "@components/popovers/ClipboardPanel";
import WakeOnLanModal from "@components/popovers/WakeOnLan/Index";
import MountPopopover from "@components/popovers/MountPopover";
import ExtensionPopover from "@components/popovers/ExtensionPopover";
import { JsonRpcResponse, useJsonRpc } from "@hooks/useJsonRpc";
import { m } from "@localizations/messages.js";

export default function Actionbar({
  requestFullscreen,
}: {
  requestFullscreen: () => Promise<void>;
}) {
  const { navigateTo } = useDeviceUiNavigation();
  const { id: deviceId } = useParams();
  const paired = useClipboardStore(state => !!deviceId && state.devices[deviceId]?.paired);
  const pasting = useClipboardStore(state => state.pasting);
  const [readingClipboard, setReadingClipboard] = useState(false);
  const directPaste = useRef<AbortController | null>(null);
  const { executeMacro } = useKeyboard();
  const executeMacroRef = useRef(executeMacro);
  executeMacroRef.current = executeMacro;
  useEffect(() => {
    directPaste.current = null;
    setReadingClipboard(false);
    return () => directPaste.current?.abort();
  }, [deviceId]);

  async function pasteFromDevice() {
    if (!deviceId || directPaste.current) return;
    const ac = new AbortController();
    directPaste.current = ac;
    setReadingClipboard(true);
    try {
      const text = await readLocalClipboard();
      await pasteTextOnMac(deviceId, text, ac.signal, steps => executeMacroRef.current(steps));
      if (!ac.signal.aborted) notifications.success(m.clipboard_paste_sent());
    } catch (cause) {
      if (!ac.signal.aborted)
        notifications.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (directPaste.current === ac) directPaste.current = null;
      if (!ac.signal.aborted) setReadingClipboard(false);
    }
  }

  const { isVirtualKeyboardEnabled, setVirtualKeyboardEnabled } = useHidStore();
  const {
    setDisableVideoFocusTrap,
    terminalType,
    setTerminalType,
    toggleSidebarView,
    isOcrMode,
    setOcrMode,
    usbSerialConsoleEnabled,
    setUsbSerialConsoleEnabled,
    isEmbedMode,
  } = useUiStore();
  const { remoteVirtualMediaState } = useMountMediaStore();
  const { width: videoWidth, height: videoHeight } = useVideoStore();
  const { developerMode } = useSettingsStore();
  const { send } = useJsonRpc();

  useEffect(() => {
    send("getUsbDevices", {}, (resp: JsonRpcResponse) => {
      if ("error" in resp) return;
      const devices = resp.result as { serial_console?: boolean };
      setUsbSerialConsoleEnabled(devices.serial_console === true);
    });
  }, [send, setUsbSerialConsoleEnabled]);

  // This is the only way to get a reliable state change for the popover
  // at time of writing this there is no mount, or unmount event for the popover
  const isOpen = useRef<boolean>(false);
  const checkIfStateChanged = useCallback(
    (open: boolean) => {
      if (open !== isOpen.current) {
        isOpen.current = open;
        if (!open) {
          setTimeout(() => {
            setDisableVideoFocusTrap(false);
            console.debug("Popover is closing. Returning focus trap to video");
          }, 0);
        }
      }
    },
    [setDisableVideoFocusTrap],
  );

  return (
    <Container className="min-w-0 border-b border-b-slate-800/20 bg-white px-2 lg:px-8 dark:border-b-slate-300/20 dark:bg-slate-900">
      <div
        onKeyUp={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        className="mobile-touch-controls flex items-center justify-between gap-x-4 gap-y-2 overflow-x-auto py-1.5 lg:flex-wrap lg:overflow-visible"
      >
        <div className="relative flex shrink-0 items-center gap-x-2 gap-y-2 lg:flex-wrap">
          {developerMode && usbSerialConsoleEnabled ? (
            <SplitButtonGroup>
              <SplitButtonPrimary
                icon={({ className }) => <CommandLineIcon className={className} />}
                label={m.kvm_terminal()}
                onClick={() => setTerminalType(terminalType === "kvm" ? "none" : "kvm")}
              />
              <SplitButtonCaret
                menuItems={[
                  {
                    label: "USB Serial Console",
                    icon: LuTerminal,
                    onClick: () => setTerminalType(terminalType === "cdcacm" ? "none" : "cdcacm"),
                    active: terminalType === "cdcacm",
                  },
                ]}
              />
            </SplitButtonGroup>
          ) : developerMode ? (
            <Button
              size="XS"
              theme="light"
              text={m.kvm_terminal()}
              LeadingIcon={({ className }) => <CommandLineIcon className={className} />}
              onClick={() => setTerminalType(terminalType === "kvm" ? "none" : "kvm")}
            />
          ) : usbSerialConsoleEnabled ? (
            <Button
              size="XS"
              theme="light"
              text="USB Serial Console"
              LeadingIcon={LuTerminal}
              onClick={() => setTerminalType(terminalType === "cdcacm" ? "none" : "cdcacm")}
            />
          ) : null}
          {isInCloud && paired && (
            <Button
              size="XS"
              theme="primary"
              text={m.clipboard_paste_direct()}
              LeadingIcon={MdOutlineContentPasteGo}
              disabled={pasting || readingClipboard}
              onClick={() => void pasteFromDevice()}
            />
          )}
          <Popover>
            <SplitButtonGroup>
              <PopoverButton
                as={SplitButtonPrimary}
                icon={MdOutlineContentPasteGo}
                label={m.clipboard_title()}
                onClick={() => setDisableVideoFocusTrap(true)}
              />
              <SplitButtonCaret
                menuItems={[
                  {
                    label: `${m.action_bar_copy_text()} (OCR)`,
                    icon: LuScanText,
                    onClick: () => setOcrMode(!isOcrMode),
                    active: isOcrMode,
                    disabled: videoWidth === 0 || videoHeight === 0,
                  },
                ]}
              />
            </SplitButtonGroup>
            <PopoverPanel
              anchor="bottom start"
              transition
              className={cx(
                "mobile-touch-controls z-10 flex max-h-[calc(100dvh-5rem)] w-[min(420px,calc(100vw-1rem))] origin-top flex-col overflow-y-auto overscroll-contain [--anchor-padding:8px]",
                "flex origin-top flex-col transition duration-300 ease-out data-closed:translate-y-8 data-closed:opacity-0",
              )}
            >
              {({ open }) => {
                checkIfStateChanged(open);
                return (
                  <div className="mx-auto w-full max-w-xl">
                    <ClipboardPanel />
                  </div>
                );
              }}
            </PopoverPanel>
          </Popover>
          <div className="relative">
            <Popover>
              <PopoverButton as={Fragment}>
                <Button
                  size="XS"
                  theme="light"
                  text={m.action_bar_virtual_media()}
                  LeadingIcon={({ className }) => {
                    return (
                      <>
                        <LuHardDrive className={className} />
                        <div
                          className={cx(className, "h-2 w-2 rounded-full bg-blue-700", {
                            hidden: !remoteVirtualMediaState,
                          })}
                        />
                      </>
                    );
                  }}
                  onClick={() => {
                    setDisableVideoFocusTrap(true);
                  }}
                />
              </PopoverButton>
              <PopoverPanel
                anchor="bottom start"
                transition
                className={cx(
                  "mobile-touch-controls z-10 flex max-h-[calc(100dvh-5rem)] w-[min(420px,calc(100vw-1rem))] origin-top flex-col overflow-y-auto overscroll-contain [--anchor-padding:8px] lg:overflow-visible!",
                  "flex origin-top flex-col transition duration-300 ease-out data-closed:translate-y-8 data-closed:opacity-0",
                )}
              >
                {({ open }) => {
                  checkIfStateChanged(open);
                  return (
                    <div className="mx-auto w-full max-w-xl">
                      <MountPopopover />
                    </div>
                  );
                }}
              </PopoverPanel>
            </Popover>
          </div>
          <div>
            <Popover>
              <PopoverButton as={Fragment}>
                <Button
                  size="XS"
                  theme="light"
                  text={m.action_bar_wake_on_lan()}
                  onClick={() => {
                    setDisableVideoFocusTrap(true);
                  }}
                  LeadingIcon={({ className }) => (
                    <svg
                      className={className}
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m15 20 3-3h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2l3 3z" />
                      <path d="M6 8v1" />
                      <path d="M10 8v1" />
                      <path d="M14 8v1" />
                      <path d="M18 8v1" />
                    </svg>
                  )}
                />
              </PopoverButton>
              <PopoverPanel
                anchor="bottom start"
                transition
                style={{
                  transitionProperty: "opacity",
                }}
                className={cx(
                  "mobile-touch-controls z-10 flex max-h-[calc(100dvh-5rem)] w-[min(420px,calc(100vw-1rem))] origin-top flex-col overflow-y-auto overscroll-contain [--anchor-padding:8px] lg:overflow-visible!",
                  "flex origin-top flex-col transition duration-300 ease-out data-closed:translate-y-8 data-closed:opacity-0",
                )}
              >
                {({ open }) => {
                  checkIfStateChanged(open);
                  return (
                    <div className="mx-auto w-full max-w-xl">
                      <WakeOnLanModal />
                    </div>
                  );
                }}
              </PopoverPanel>
            </Popover>
          </div>
          <div className="hidden lg:block">
            <Button
              size="XS"
              theme="light"
              text={m.action_bar_virtual_keyboard()}
              LeadingIcon={FaKeyboard}
              onClick={() => setVirtualKeyboardEnabled(!isVirtualKeyboardEnabled)}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-x-2 gap-y-2 lg:flex-wrap">
          <Popover>
            <PopoverButton as={Fragment}>
              <Button
                size="XS"
                theme="light"
                text={m.action_bar_extension()}
                LeadingIcon={LuCable}
                onClick={() => {
                  setDisableVideoFocusTrap(true);
                }}
              />
            </PopoverButton>
            <PopoverPanel
              anchor="bottom start"
              transition
              className={cx(
                "mobile-touch-controls z-10 flex max-h-[calc(100dvh-5rem)] w-[min(420px,calc(100vw-1rem))] flex-col overflow-y-auto overscroll-contain [--anchor-padding:8px] lg:overflow-visible!",
                "flex origin-top flex-col transition duration-300 ease-out data-closed:translate-y-8 data-closed:opacity-0",
              )}
            >
              {({ open }) => {
                checkIfStateChanged(open);
                return <ExtensionPopover />;
              }}
            </PopoverPanel>
          </Popover>

          <div className="block lg:hidden">
            <Button
              size="XS"
              theme="light"
              text={m.action_bar_virtual_keyboard()}
              LeadingIcon={FaKeyboard}
              onClick={() => setVirtualKeyboardEnabled(!isVirtualKeyboardEnabled)}
            />
          </div>
          <div className="hidden lg:block">
            <Button
              size="XS"
              theme="light"
              text={m.action_bar_connection_stats()}
              LeadingIcon={({ className }) => (
                <LuSignal className={cx(className, "mb-0.5 text-green-500")} strokeWidth={4} />
              )}
              onClick={() => {
                toggleSidebarView("connection-stats");
              }}
            />
          </div>
          {!isEmbedMode && (
            <div>
              <Button
                size="XS"
                theme="light"
                text={m.action_bar_settings()}
                LeadingIcon={LuSettings}
                onClick={() => {
                  setDisableVideoFocusTrap(true);
                  navigateTo("/settings");
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-x-2">
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-600" />
            {isEmbedMode ? (
              <Button
                size="XS"
                theme="light"
                text={m.close()}
                LeadingIcon={LuX}
                onClick={() => window.close()}
              />
            ) : (
              <SplitButtonGroup>
                <SplitButtonPrimary
                  icon={LuMaximize}
                  label={m.action_bar_fullscreen()}
                  onClick={() => requestFullscreen()}
                />
                <SplitButtonCaret
                  menuItems={[
                    {
                      label: m.action_bar_compact_window(),
                      icon: LuExternalLink,
                      onClick: () => {
                        const url = new URL(window.location.href);
                        url.searchParams.set("embed", "");
                        window.open(url.toString(), "_blank", "noopener");
                      },
                    },
                  ]}
                />
              </SplitButtonGroup>
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}
