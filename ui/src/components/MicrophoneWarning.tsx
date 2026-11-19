import { Fragment, useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { invoke, type MicWarning } from "../lib/tauri";
import { Button } from "./ui";

/// Backend failures here only cost a repeated warning, never the user's settings.
const quietly = (command: string, args?: Record<string, unknown>) => {
  Promise.resolve()
    .then(() => invoke(command, args))
    .catch(() => undefined);
};

interface Props {
  warning: MicWarning | null;
  onSettings: () => void;
}

export function MicrophoneWarning({ warning, onSettings }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const open = !!warning && warning.id !== dismissed;

  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  const dismiss = () => { if (warning) setDismissed(warning.id); };
  // OK silences this outage across restarts until the input returns; Escape only closes the dialog.
  const acknowledge = () => {
    if (warning) quietly("dismiss_mic_warning", { id: warning.id });
    dismiss();
  };

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby="microphone-warning-title"
      aria-describedby="microphone-warning-description"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      className="m-auto w-[min(480px,calc(100%_-_48px))] rounded-xl border border-line bg-panel p-6 text-fg shadow-[0_24px_64px_rgba(0,0,0,.6)] backdrop:bg-black/60 backdrop:backdrop-blur-[16px] reduce-transparency:backdrop:bg-black/85 reduce-transparency:backdrop:backdrop-blur-none"
    >
      <h2 id="microphone-warning-title" className="text-[17px] font-semibold tracking-[-.01em]">{t("microphone.warningTitle")}</h2>
      <p id="microphone-warning-description" className="mt-3 whitespace-pre-line break-words text-[13px] leading-relaxed text-muted">
        {warning && t(`microphone.${warning.reason}`).split("{name}").map((part, index) => (
          <Fragment key={index}>
            {index > 0 && <strong className="font-semibold text-fg">{warning.deviceName || t("microphone.defaultName")}</strong>}
            {part}
          </Fragment>
        ))}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={() => { dismiss(); onSettings(); }}>{t("microphone.openSettings")}</Button>
        <Button variant="primary" onClick={acknowledge} autoFocus>{t("microphone.dismiss")}</Button>
      </div>
    </dialog>
  );
}
