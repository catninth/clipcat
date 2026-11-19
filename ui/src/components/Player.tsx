import { useCallback, useEffect, useRef, useState } from "react";
import { cx, formatDate, formatDuration, formatSize, gameOf } from "../lib/format";
import { t } from "../lib/i18n";
import { convertFileSrc, invoke } from "../lib/tauri";
import type { Clip } from "../lib/tauri";
import { canTrim, clampEnd, clampStart, isWholeClip } from "../lib/trim";
import { Trimmer } from "./Trimmer";
import { Button } from "./ui";

interface Props {
  clip: Clip | null;
  playbackKey: number;
  onClose: () => void;
  onDelete: (clip: Clip) => void;
  onRenamed: (previous: Clip, updated: Clip) => void;
  onTrimmed: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

interface TrimRange {
  duration: number;
  start: number;
  end: number;
}

// Close enough to the end handle to loop before the video runs past it.
const LOOP_MARGIN = 0.03;

// Highlight by dimming: the background recedes while the player arrives as a material surface.
// Keep the modal in the DOM so its entrance and exit can be animated.
export function Player({ playbackKey, clip, ...actions }: Props) {
  // Keep the last clip's details visible while the modal fades out after closing
  const [last, setLast] = useState<Clip | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = !!clip;
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
  return (
    <div
      className={cx(
        "fixed inset-0 z-10 grid place-items-center bg-black/60 p-8",
        clip
          ? "visible opacity-100 backdrop-blur-[16px] [transition:opacity_200ms_ease,visibility_0s,backdrop-filter_250ms_ease] reduce-transparency:bg-black/85 reduce-transparency:backdrop-blur-none"
          : "invisible opacity-0 backdrop-blur-none [transition:opacity_200ms_ease,visibility_0s_linear_250ms,backdrop-filter_250ms_ease]",
      )}
      inert={!clip}
      onClick={(e) => { if (e.target === e.currentTarget) actions.onClose(); }}
    >
      {shown && <PlayingClip key={playbackKey} clip={shown} open={open} focusDialog={focusDialog} {...actions} />}
    </div>
  );
}

function releaseVideo(player: HTMLVideoElement) {
  if (!player.hasAttribute("src")) return;
  player.pause();
  player.removeAttribute("src");
  player.load();
}

function PlayingClip({ clip, open, onClose, onDelete, onRenamed, onTrimmed, onPrevious, onNext, focusDialog }:
  Omit<Props, "clip" | "playbackKey"> & { clip: Clip; open: boolean; focusDialog: (dialog: HTMLDivElement) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // Only opening a different clip changes the playback key. A rename updates the label alone.
  const [openingPath] = useState(clip.path);
  const session = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(NaN);
  const [trim, setTrim] = useState<TrimRange | null>(null);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const editing = draft !== null;
  const trimming = trim !== null;
  const extension = clip.name.slice(clip.name.lastIndexOf("."));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    focusDialog(dialog.current!);
    const player = video.current!;
    const stop = (token: string) => { void invoke("stop_playback", { token }).catch(() => {}); };
    void invoke<string>("start_playback", { path: openingPath }).then((token) => {
      if (cancelled) { stop(token); return; }
      session.current = token;
      player.src = convertFileSrc(token);
      setReady(true);
      void player.play().catch(() => {});
    }).catch((err) => { if (!cancelled) setError(String(err)); });
    return () => {
      cancelled = true;
      releaseVideo(player);
      if (session.current) stop(session.current);
      session.current = null;
    };
  }, [open, openingPath, focusDialog]);

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

  useEffect(() => {
    if (!open) return;
    // Space is claimed in the capture phase, before the focused video's native controls or a
    // focused button can toggle too, which would pause and immediately resume playback.
    const claimSpace = (e: KeyboardEvent) => {
      // The file name field takes spaces as text
      if (e.key !== " " || editing || !ready || busy) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    const onSpaceDown = (e: KeyboardEvent) => {
      if (claimSpace(e) && !e.repeat) togglePlay();
    };
    // A focused button clicks on keyup, and media controls may react to keypress.
    const onSpaceOther = (e: KeyboardEvent) => { claimSpace(e); };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Escape") return;
      if (editing) {
        if (!busy) { setDraft(null); setError(""); }
      } else if (trimming) {
        if (!busy) setTrim(null);
      } else onClose();
    };
    document.addEventListener("keydown", onSpaceDown, true);
    document.addEventListener("keypress", onSpaceOther, true);
    document.addEventListener("keyup", onSpaceOther, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onSpaceDown, true);
      document.removeEventListener("keypress", onSpaceOther, true);
      document.removeEventListener("keyup", onSpaceOther, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, editing, trimming, ready, busy, onClose, trim]);

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

  // Follow the video every frame: timeupdate is too coarse for the playhead and the loop.
  const end = trim?.end;
  const start = trim?.start;
  useEffect(() => {
    if (end === undefined || start === undefined || busy) return;
    const player = video.current!;
    let frame = requestAnimationFrame(function follow() {
      if (!player.paused && player.currentTime >= end - LOOP_MARGIN) player.currentTime = start;
      setTime(player.currentTime);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [start, end, busy]);

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

  const seek = (seconds: number) => {
    video.current!.currentTime = seconds;
    setTime(seconds);
  };

  const startTrim = () => {
    const player = video.current!;
    player.pause();
    setTime(player.currentTime);
    setConfirmDelete(false);
    setConfirmReplace(false);
    setError("");
    setTrim({ duration, start: 0, end: duration });
  };

  const moveStart = (seconds: number) => {
    const next = clampStart(seconds, trim!.end);
    setTrim({ ...trim!, start: next });
    seek(next);
  };

  const moveEnd = (seconds: number) => {
    const next = clampEnd(seconds, trim!.start, trim!.duration);
    setTrim({ ...trim!, end: next });
    seek(next);
  };

  const togglePlay = () => {
    const player = video.current!;
    if (!player.paused) {
      player.pause();
      return;
    }
    if (trim && player.currentTime >= trim.end - LOOP_MARGIN) seek(trim.start);
    void player.play().catch(() => {});
  };

  // The player reads through its own handle, which lets the original move to the Recycle Bin.
  const saveTrim = (replace: boolean) => {
    const range = trim!;
    video.current!.pause();
    void act(async (current) => {
      await invoke("trim_clip", { path: current.path, start: range.start, end: range.end, replace });
      onTrimmed();
      finish();
    });
    setConfirmReplace(false);
  };

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={clip.name}
      className={cx(
        "flex w-[min(1200px,100%)] flex-col gap-3.5 outline-none transition-[scale] duration-350 ease-spring motion-reduce:scale-100",
        open ? "scale-100" : "scale-[.96]",
      )}
    >
      <div className="relative">
        <video
          ref={video}
          controls={!trimming}
          className={cx(
            "block w-full rounded-xl bg-black shadow-[0_0_0_1px_var(--color-line),0_24px_64px_rgba(0,0,0,.6)]",
            trimming ? "max-h-[calc(100vh-300px)]" : "max-h-[calc(100vh-180px)]",
          )}
          onClick={trimming && !busy ? togglePlay : undefined}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        />
        {onPrevious && !trimming && <StepButton previous onClick={onPrevious} disabled={busy} />}
        {onNext && !trimming && <StepButton onClick={onNext} disabled={busy} />}
      </div>
      {trim && (
        <Trimmer
          duration={trim.duration}
          start={trim.start}
          end={trim.end}
          time={time}
          disabled={busy}
          onStart={moveStart}
          onEnd={moveEnd}
          onSeek={seek}
        />
      )}
      {trim ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="w-[34px] px-0!"
            disabled={busy}
            title={t(paused ? "player.trimPlay" : "player.trimPause")}
            aria-label={t(paused ? "player.trimPlay" : "player.trimPause")}
            onClick={togglePlay}
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
              <path d={paused ? "M4.5 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5a.5.5 0 0 0-.76.43Z" : "M4 2.5h3v11H4zM9 2.5h3v11H9z"} />
            </svg>
          </Button>
          <div className="min-w-28 flex-1 pl-1.5">
            <div className="text-[13px] font-semibold tabular">{`${formatDuration(time)} / ${formatDuration(trim.duration)}`}</div>
            {busy && <div className="truncate text-[12.5px] text-muted">{t("player.trimSaving")}</div>}
          </div>
          <Button variant="primary" disabled={busy || isWholeClip(trim.start, trim.end, trim.duration)} onClick={() => saveTrim(false)}>
            {t("player.trimSaveCopy")}
          </Button>
          <Button
            variant={confirmReplace ? "confirm" : "danger"}
            disabled={busy || isWholeClip(trim.start, trim.end, trim.duration)}
            onClick={confirmReplace ? () => saveTrim(true) : () => setConfirmReplace(true)}
          >
            {t(confirmReplace ? "player.trimReplaceConfirm" : "player.trimReplace")}
          </Button>
          <Button disabled={busy} onClick={() => { setTrim(null); setError(""); }}>{t("player.trimCancel")}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
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
            <Button disabled={!ready || busy || !canTrim(duration)} onClick={startTrim}>{t("player.trim")}</Button>
            <Button disabled={!ready || busy} onClick={() => void act((c) => invoke("reveal_clip", { path: c.path }))}>{t("player.reveal")}</Button>
            <Button disabled={!ready || busy} onClick={() => void act(async (c) => { await invoke("open_clip", { path: c.path }); finish(); })}>{t("player.openExternal")}</Button>
            <Button ref={renameButton} disabled={!ready || busy} onClick={() => {
              setConfirmDelete(false);
              setError("");
              setDraft(clip.name.slice(0, -extension.length));
            }}>{t("player.rename")}</Button>
            <Button disabled={!ready || busy} variant={confirmDelete ? "confirm" : "danger"}
              onClick={confirmDelete ? () => void act((c) => { finish(); onDelete(c); }) : () => setConfirmDelete(true)}>
              {t(confirmDelete ? "player.deleteConfirm" : "player.delete")}
            </Button>
            <Button onClick={onClose}>{t("player.close")}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-danger-soft">{error}</p>}
    </div>
  );
}

function withPath(clip: Clip, path: string): Clip {
  if (path === clip.path) return clip;
  const separator = path.startsWith("/") ? path.lastIndexOf("/") : Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { ...clip, path, name: path.slice(separator + 1) };
}

function StepButton({ previous, onClick, disabled }: { previous?: boolean; onClick: () => void; disabled: boolean }) {
  const label = t(previous ? "player.previous" : "player.next");
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cx(
        "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/65 text-white shadow-md transition hover:bg-black/85 active:scale-95 disabled:opacity-40",
        previous ? "left-3" : "right-3",
      )}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={previous ? "m14.5 5-7 7 7 7" : "m9.5 5 7 7-7 7"} />
      </svg>
    </button>
  );
}
