import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx, formatDate, formatSize, gameOf } from "../lib/format";
import { t } from "../lib/i18n";
import { convertFileSrc, invoke } from "../lib/tauri";
import type { Clip, TrimResult } from "../lib/tauri";
import { PlayerControls } from "./PlayerControls";
import { Button } from "./ui";

interface Props {
  clip: Clip | null;
  playbackKey: number;
  onClose: () => void;
  onDelete: (clip: Clip) => void;
  onRenamed: (previous: Clip, updated: Clip) => void;
  onExported: (result: TrimResult) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

interface ExportNotice {
  paths: string[];
  sourceName: string;
  text: string;
  error: boolean;
}

// Highlight by dimming: the background recedes while the player arrives as a material surface.
// Keep the modal in the DOM so its entrance and exit can be animated.
export function Player({ playbackKey, clip, ...actions }: Props) {
  // Keep the last clip's details visible while the modal fades out after closing
  const [last, setLast] = useState<Clip | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<ExportNotice | null>(null);
  const open = !!clip;
  const currentNotice = !!clip && !!notice?.paths.includes(clip.path);
  useEffect(() => {
    if (!notice || currentNotice) return;
    const timer = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(timer);
  }, [notice, currentNotice]);
  useEffect(() => {
    const update = () => setFullscreen(!!shell.current && document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    if (!open) {
      if (shell.current && document.fullscreenElement === shell.current) void document.exitFullscreen().catch(() => {});
    }
  }, [open]);
  const focusDialog = useCallback((dialog: HTMLDivElement) => {
    if (!trigger.current && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement;
    dialog.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    return () => {
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
      trigger.current = null;
    };
  }, [open]);
  useEffect(() => { if (clip) setLast(clip); }, [clip]);
  const shown = clip ?? last;
  const feedback = notice && <div className={open ? "player-message" : "player-notice"}>
    <p role={currentNotice && notice.error ? "alert" : "status"} className={notice.error ? "text-danger-soft" : undefined}>
      {currentNotice ? notice.text : `${notice.sourceName} · ${notice.text}`}
    </p>
    <button type="button" aria-label={t("player.dismissStatus")} title={t("player.dismissStatus")}
      onClick={() => setNotice(null)}>×</button>
  </div>;
  return (<>
    <div ref={shell}
      className={cx(
        "player-shell fixed inset-0 z-10 grid place-items-center bg-black/60",
        clip
          ? "visible opacity-100 backdrop-blur-[16px] [transition:opacity_200ms_ease,visibility_0s,backdrop-filter_250ms_ease] reduce-transparency:bg-black/85 reduce-transparency:backdrop-blur-none"
          : "invisible opacity-0 backdrop-blur-none [transition:opacity_200ms_ease,visibility_0s_linear_250ms,backdrop-filter_250ms_ease]",
      )}
      inert={!clip}
      onClick={(e) => { if (e.target === e.currentTarget) actions.onClose(); }}
    >
      {shown && <PlayingClip key={playbackKey} clip={shown} open={open} focusDialog={focusDialog}
        fullscreen={fullscreen} feedback={open ? feedback : null} onNotice={setNotice} {...actions} />}
    </div>
    {!open && feedback}
  </>);
}

function releaseVideo(player: HTMLVideoElement) {
  if (!player.hasAttribute("src")) return;
  player.pause();
  player.removeAttribute("src");
  player.load();
}

interface PlayingProps extends Omit<Props, "clip" | "playbackKey"> {
  clip: Clip;
  open: boolean;
  fullscreen: boolean;
  feedback: React.ReactNode;
  onNotice: (value: ExportNotice | null) => void;
  focusDialog: (dialog: HTMLDivElement) => void;
}

function PlayingClip({ clip, open, onClose, onDelete, onRenamed, onExported, onPrevious, onNext,
  focusDialog, fullscreen, feedback, onNotice }: PlayingProps) {
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // Only opening a different clip changes the playback key. A rename updates the label alone.
  const [openingPath] = useState(clip.path);
  const session = useRef<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const ready = !!src;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportingNow = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const editing = draft !== null;
  const extension = clip.name.slice(clip.name.lastIndexOf("."));

  useLayoutEffect(() => {
    if (open && dialog.current) focusDialog(dialog.current);
  }, [open, focusDialog]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const player = video.current!;
    const stop = (token: string) => { void invoke("stop_playback", { token }).catch(() => {}); };
    void invoke<string>("start_playback", { path: openingPath }).then((token) => {
      if (cancelled) { stop(token); return; }
      session.current = token;
      const url = convertFileSrc(token);
      player.src = url;
      setSrc(url);
      void player.play().catch(() => {});
    }).catch((err) => { if (!cancelled) setError(String(err)); });
    return () => {
      cancelled = true;
      releaseVideo(player);
      if (session.current) stop(session.current);
      session.current = null;
    };
  }, [open, openingPath]);

  // Explorer may rename the playing file while this window is in the background.
  useEffect(() => {
    if (!open || !ready) return;
    let alive = true;
    const sync = () => {
      const token = session.current;
      if (!token) return;
      void invoke<string>("resolve_playback", { token, path: clip.path }).then((path) => {
        if (alive && session.current === token && path !== clip.path) onRenamed(clip, withPath(clip, path));
      }).catch(() => {});
    };
    window.addEventListener("focus", sync);
    return () => { alive = false; window.removeEventListener("focus", sync); };
  }, [open, ready, clip, onRenamed]);

  const toggleFullscreen = () => {
    const surface = dialog.current?.parentElement;
    if (!surface) return;
    const operation = document.fullscreenElement === surface ? document.exitFullscreen?.() : surface.requestFullscreen?.();
    if (operation) void operation.catch(() => setError(t("player.fullscreenError")));
    else setError(t("player.fullscreenError"));
  };

  // Escape always uses the editing/busy state committed with the visible buttons and alerts.
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Escape") return;
      if (e.target instanceof Node && e.target !== document && !dialog.current?.contains(e.target)) return;
      if (document.fullscreenElement === dialog.current?.parentElement) {
        void document.exitFullscreen().catch(() => setError(t("player.fullscreenError")));
      } else if (editing) {
        if (!busy) { setDraft(null); setError(""); }
      } else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, editing, busy, onClose]);

  useEffect(() => {
    if (editing) {
      returnFocus.current = true;
      input.current?.focus();
      input.current?.select();
    } else if (returnFocus.current && !busy) {
      returnFocus.current = false;
      renameButton.current?.focus();
    }
  }, [editing, busy]);

  // Always resolve from the handle: another clip may now occupy the original pathname.
  const act = async (action: (current: Clip) => Promise<void> | void) => {
    const token = session.current;
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const path = await invoke<string>("resolve_playback", { token, path: clip.path });
      if (session.current !== token) return;
      const current = withPath(clip, path);
      if (current !== clip) onRenamed(clip, current);
      await action(current);
    } catch (e) {
      if (session.current === token) setError(String(e));
    } finally {
      if (session.current === token) setBusy(false);
    }
  };

  const finish = () => {
    // Release media before closing; onClose's effect runs after this handler.
    if (!session.current || !video.current) return;
    releaseVideo(video.current);
    onClose();
  };

  const exportRange = async (startSeconds: number, endSeconds: number, trashOriginal: boolean) => {
    const token = session.current;
    if (!token || busy || exportingNow.current) return false;
    exportingNow.current = true;
    setExporting(true);
    setError("");
    onNotice(null);
    try {
      const result = await invoke<TrimResult>("export_clip_range", { token, path: clip.path, startSeconds, endSeconds, trashOriginal });
      onNotice({
        paths: [clip.path, result.clip.path], sourceName: clip.name, error: !!result.trashError,
        text: result.trashError ? t("player.trimTrashFailed", { name: result.clip.name, error: result.trashError })
          : t("player.trimSaved", { name: result.clip.name }),
      });
      onExported(result);
      return true;
    } catch (error) {
      onNotice({ paths: [clip.path], sourceName: clip.name, error: true, text: String(error) });
      return false;
    } finally {
      exportingNow.current = false;
      if (session.current === token) setExporting(false);
    }
  };

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={clip.name}
      className={cx(
        "player-dialog outline-none transition-[scale] duration-350 ease-spring motion-reduce:scale-100",
        open ? "scale-100" : "scale-[.96]",
      )}
    >
      <PlayerControls video={video} dialog={dialog} open={open} src={src} fullscreen={fullscreen}
        busy={busy} exporting={exporting} editing={editing} onError={setError}
        onExport={exportRange} onFullscreen={toggleFullscreen} onPrevious={onPrevious} onNext={onNext} />
      <div className="player-files flex flex-wrap items-center gap-2">
        {draft !== null ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            void act(async (current) => {
              const updated = await invoke<Clip>("rename_clip", { path: current.path, newStem: draft });
              onRenamed(current, updated);
              setDraft(null);
            });
          }}>
            <label className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="text-muted">{t("player.fileName")}</span>
              <input ref={input} value={draft} disabled={busy} spellCheck={false}
                className="h-[34px] min-w-16 flex-1 rounded-lg bg-panel-2 px-2.5 select-text"
                onChange={(e) => { setDraft(e.target.value); setError(""); }} />
            </label>
            <span className="text-muted">{extension}</span>
            <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>{t("player.saveName")}</Button>
            <Button disabled={busy} onClick={() => { setDraft(null); setError(""); }}>{t("player.cancelRename")}</Button>
          </form>
        ) : (
          <div className="min-w-28 flex-1">
            <div className="truncate text-[15px] font-semibold tracking-[-.01em]" title={clip.name}>{clip.name}</div>
            <div className="text-[12.5px] text-muted tabular">{gameOf(clip)} · {formatDate(clip.created)} · {formatSize(clip.size)}</div>
          </div>
        )}
        <div className={cx("flex flex-wrap gap-2", editing && "hidden")}>
          <Button disabled={!ready || busy || exporting} onClick={() => void act((c) => invoke("reveal_clip", { path: c.path }))}>{t("player.reveal")}</Button>
          <Button disabled={!ready || busy || exporting} onClick={() => void act(async (c) => { await invoke("open_clip", { path: c.path }); finish(); })}>{t("player.openExternal")}</Button>
          <Button ref={renameButton} disabled={!ready || busy || exporting} onClick={() => {
            setConfirmDelete(false);
            setError("");
            setDraft(clip.name.slice(0, -extension.length));
          }}>{t("player.rename")}</Button>
          <Button disabled={!ready || busy || exporting} variant={confirmDelete ? "confirm" : "danger"}
            onClick={confirmDelete ? () => void act((c) => { finish(); onDelete(c); }) : () => setConfirmDelete(true)}>
            {t(confirmDelete ? "player.deleteConfirm" : "player.delete")}
          </Button>
          <Button onClick={onClose}>{t("player.close")}</Button>
        </div>
      </div>
      {feedback}
      {error && <p role="alert" className="player-message text-danger-soft">{error}</p>}
    </div>
  );
}

function withPath(clip: Clip, path: string): Clip {
  if (path === clip.path) return clip;
  const separator = path.startsWith("/") ? path.lastIndexOf("/") : Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { ...clip, path, name: path.slice(separator + 1) };
}
