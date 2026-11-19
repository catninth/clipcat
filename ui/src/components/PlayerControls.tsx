import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { t } from "../lib/i18n";
import { playerTime } from "../lib/playerTime";
import { Button } from "./ui";
import { PlayerTimeline } from "./PlayerTimeline";
import "./player.css";

interface Props {
  video: RefObject<HTMLVideoElement | null>;
  dialog: RefObject<HTMLDivElement | null>;
  src: string | null;
  open: boolean;
  fullscreen: boolean;
  busy: boolean;
  exporting: boolean;
  editing: boolean;
  onFullscreen: () => void;
  onExport: (start: number, end: number, trashOriginal: boolean) => Promise<boolean>;
  onError: (message: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const icons = {
  play: <path fill="currentColor" stroke="none" d="M6 3.7a.9.9 0 0 1 1.4-.75l14 8.3a.9.9 0 0 1 0 1.5l-14 8.3A.9.9 0 0 1 6 20.3z" />,
  pause: <path fill="currentColor" stroke="none" d="M5 4h5v16H5zm9 0h5v16h-5z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />,
  previous: <path d="M5 5v14m13-14-9 7 9 7z" />,
  next: <path d="M19 5v14M6 5l9 7-9 7z" />,
  back: <><path d="M4 10a8 8 0 1 1 .6 7M3.5 4.5V10H9" /><path d="M14.4 9.2h-3.7l-.4 3.2c2.7-1.1 4.7-.5 4.2 1.7-.3 1.6-2.5 2.4-4.5 1.2" strokeWidth="1.5" /></>,
  forward: <><path d="M20 10a8 8 0 1 0-.6 7m1.1-12.5V10H15" /><path d="M14 9.2h-3.7l-.4 3.2c2.7-1.1 4.7-.5 4.2 1.7-.3 1.6-2.5 2.4-4.5 1.2" strokeWidth="1.5" /></>,
  volume: <><path d="M3 9h4l5-4v14l-5-4H3z" /><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  mute: <><path d="M3 9h4l5-4v14l-5-4H3z" /><path d="m16 9 6 6m0-6-6 6" /></>,
  repeat: <><path d="M4 10V8a3 3 0 0 1 3-3h12m-3-3 3 3-3 3M20 14v2a3 3 0 0 1-3 3H5m3-3-3 3 3 3" /></>,
  fullscreen: <path d="M3.5 9V3.5H9m6 0h5.5V9m0 6v5.5H15m-6 0H3.5V15" />,
  exitFullscreen: <path d="M3.5 9H9V3.5m6 0V9h5.5m0 6H15v5.5m-6 0V15H3.5" />,
  cut: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="m8.3 7.8 12 11.5m-12-3.1L20.3 4.7" /></>,
};

function Control({ icon, label, title = label, pressed, disabled, onClick, children, primary, button }: {
  icon: keyof typeof icons; label: string; title?: string; pressed?: boolean; disabled?: boolean;
  onClick: () => void; children?: ReactNode; primary?: boolean; button?: RefObject<HTMLButtonElement | null>;
}) {
  return <button ref={button} type="button" className={primary ? "media-key media-primary" : "media-key"}
    aria-label={label} title={title} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[icon]}</svg>
    {children}
  </button>;
}

export function PlayerControls({ video, dialog, src, open, fullscreen, busy, editing, exporting,
  onFullscreen, onExport, onError, onPrevious, onNext }: Props) {
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number }>();
  const [loopRange, setLoopRange] = useState(false);
  const [trash, setTrash] = useState(false);
  const resumeAfterScrub = useRef(false);
  const lastAudibleVolume = useRef(1);
  const trimButton = useRef<HTMLButtonElement>(null);
  const restoreTrimFocus = useRef(false);
  const ready = !!src && duration > 0;
  const validRange = !!range && range.end > range.start;
  const cutChosen = validRange && (range.start > 0 || range.end < duration);

  function syncTime(player: HTMLVideoElement) {
    const length = player.duration;
    const now = player.currentTime;
    setDuration(Number.isFinite(length) && length > 0 ? length : 0);
    setTime(Number.isFinite(now) ? now : 0);
    let end = 0;
    for (let i = 0; i < player.buffered.length; i++) {
      if (player.buffered.start(i) <= now && now <= player.buffered.end(i)) {
        end = player.buffered.end(i);
        break;
      }
    }
    setBuffered(end);
  }

  function seek(target: number) {
    const player = video.current;
    if (!player || !ready) return;
    const limited = range && loopRange
      ? Math.min(range.end, Math.max(range.start, target))
      : Math.min(duration, Math.max(0, target));
    player.currentTime = limited;
    setTime(limited);
  }

  function play() {
    const player = video.current;
    if (!player || !src) return;
    if (loopRange && range && (player.currentTime < range.start || player.currentTime >= range.end)) {
      player.currentTime = range.start;
    } else if (player.ended) {
      player.currentTime = 0;
    }
    void player.play().catch((error: unknown) => {
      if (player.hasAttribute("src") && !(error instanceof DOMException && error.name === "AbortError")) {
        onError(t("player.playbackError"));
      }
    });
  }

  function togglePlay() {
    if (video.current?.paused) play();
    else video.current?.pause();
  }

  function stop() {
    if (!ready || !video.current) return;
    resumeAfterScrub.current = false;
    video.current.pause();
    video.current.currentTime = 0;
    setTime(0);
  }

  function changeVolume(value: number) {
    const player = video.current;
    if (!player) return;
    player.volume = Math.max(0, Math.min(1, value));
    player.muted = player.volume === 0;
    if (player.volume > 0) lastAudibleVolume.current = player.volume;
    setVolume(player.volume);
    setMuted(player.muted);
  }

  function toggleMute() {
    const player = video.current;
    if (!player) return;
    if (player.volume === 0) {
      changeVolume(lastAudibleVolume.current);
    } else {
      player.muted = !player.muted;
      setMuted(player.muted);
    }
  }

  function changeSpeed(value: number) {
    const player = video.current;
    if (!player) return;
    try {
      player.playbackRate = value;
    } catch {
      onError(t("player.rateError"));
    }
    setSpeed(player.playbackRate);
  }

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || editing) return;
    const target = event.target === document ? document.activeElement : event.target;
    if (!(target instanceof HTMLElement) || !dialog.current?.contains(target)) return;
    if (event.key === "Escape" && range && !document.fullscreenElement) {
      if (!exporting) closeTrim();
      event.preventDefault();
      return;
    }
    if (target.closest("input, textarea, select, [contenteditable=true], [role=slider]")) return;
    const player = video.current;
    if (!player || !src) return;
    switch (event.key.toLowerCase()) {
      case " ":
        // Claim all three Space events before a focused video or button can toggle a second time.
        event.stopPropagation();
        if (event.type === "keydown" && !event.repeat) togglePlay();
        break;
      case "arrowleft": seek(player.currentTime - 5); break;
      case "arrowright": seek(player.currentTime + 5); break;
      case "arrowup": changeVolume((player.muted ? 0 : player.volume) + 0.05); break;
      case "arrowdown": changeVolume((player.muted ? 0 : player.volume) - 0.05); break;
      case "m": if (!event.repeat) toggleMute(); break;
      case "f": if (!event.repeat) onFullscreen(); break;
      default: return;
    }
    event.preventDefault();
  });
  useLayoutEffect(() => {
    if (!open) return;
    const listen = (event: KeyboardEvent) => {
      if (event.type === "keydown" || event.key === " ") handleShortcut(event);
    };
    const events = ["keydown", "keypress", "keyup"] as const;
    events.forEach(event => document.addEventListener(event, listen, true));
    return () => events.forEach(event => document.removeEventListener(event, listen, true));
  }, [dialog, open]);

  // Schedule precisely for B even when timeupdate is throttled during high-speed playback.
  useEffect(() => {
    const player = video.current;
    if (!open || !loopRange || !range || !validRange || !player) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (player.paused || player.seeking) return;
      if (player.currentTime < range.start || player.currentTime >= range.end) {
        player.currentTime = range.start;
      }
      const wait = Math.max(16, (range.end - player.currentTime) * 1000 / player.playbackRate);
      timer = setTimeout(schedule, Math.min(wait, 2147483647));
    };
    const restartAtEnd = () => {
      player.currentTime = range.start;
      void player.play().catch(() => {});
    };
    const events = ["playing", "pause", "seeking", "seeked", "ratechange", "timeupdate"];
    events.forEach(event => player.addEventListener(event, schedule));
    player.addEventListener("ended", restartAtEnd);
    schedule();
    return () => {
      clearTimeout(timer);
      events.forEach(event => player.removeEventListener(event, schedule));
      player.removeEventListener("ended", restartAtEnd);
    };
  }, [open, loopRange, range, validRange, video]);

  function closeTrim() {
    // Restore focus when the active editor control is about to leave the DOM.
    restoreTrimFocus.current = !!document.activeElement?.closest(".media-trim, .timeline-marker");
    setLoopRange(false);
    setRange(undefined);
    setTrash(false);
  }

  useLayoutEffect(() => {
    if (!range && restoreTrimFocus.current) {
      restoreTrimFocus.current = false;
      trimButton.current?.focus({ preventScroll: true });
    }
  }, [range]);

  function changeRange(start: number, end: number) {
    if (exporting) return;
    if (range && start === range.start && end === range.end) return;
    if (range && video.current) {
      const boundary = start !== range.start ? start : end;
      video.current.currentTime = boundary;
      setTime(boundary);
    }
    setRange({ start, end });
    if (end <= start) setLoopRange(false);
  }

  const soundOff = muted || volume === 0;
  return <>
    <div className="media-picture">
      <video ref={video} playsInline loop={repeat && !loopRange}
        onClick={togglePlay}
        onLoadedMetadata={event => syncTime(event.currentTarget)}
        onDurationChange={event => syncTime(event.currentTarget)}
        onTimeUpdate={event => syncTime(event.currentTarget)} onProgress={event => syncTime(event.currentTarget)}
        onSeeked={event => syncTime(event.currentTarget)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
        onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }}
        onError={event => { if (event.currentTarget.hasAttribute("src")) onError(t("player.playbackError")); }} />
    </div>
    <div className="media-dock">
      <PlayerTimeline src={open ? src : null} duration={duration} time={time} buffered={buffered}
        range={range} onSeek={seek} onRangeChange={exporting ? undefined : changeRange}
        onScrubStart={() => {
          const player = video.current;
          resumeAfterScrub.current = !!player && !player.paused;
          if (resumeAfterScrub.current) player?.pause();
        }} onScrubEnd={() => {
          if (resumeAfterScrub.current) { resumeAfterScrub.current = false; play(); }
        }} />
      <div className="media-controls">
        <div className="media-group media-transport">
          {onPrevious && <Control icon="previous" label={t("player.previous")} disabled={busy} onClick={onPrevious} />}
          <Control icon="back" label={t("player.backFive")} title={`${t("player.backFive")} (←)`} disabled={!ready}
            onClick={() => seek((video.current?.currentTime ?? time) - 5)} />
          <Control icon={playing ? "pause" : "play"} primary
            label={playing ? t("player.pause") : t("player.play")} disabled={!src} onClick={togglePlay} />
          <Control icon="stop" label={t("player.stop")} disabled={!ready} onClick={stop} />
          <Control icon="forward" label={t("player.forwardFive")} title={`${t("player.forwardFive")} (→)`} disabled={!ready}
            onClick={() => seek((video.current?.currentTime ?? time) + 5)} />
          {onNext && <Control icon="next" label={t("player.next")} disabled={busy} onClick={onNext} />}
        </div>
        <span className="media-time tabular">{playerTime(time)} <span>/ {playerTime(duration)}</span></span>
        <div className="media-group media-sound">
          <Control icon={soundOff ? "mute" : "volume"} label={soundOff ? t("player.unmute") : t("player.mute")}
            title={`${soundOff ? t("player.unmute") : t("player.mute")} (M)`} disabled={!src} onClick={toggleMute} />
          <input type="range" className="media-range" min={0} max={100} step={1} aria-label={t("player.volume")}
            value={soundOff ? 0 : Math.round(volume * 100)} aria-valuetext={`${soundOff ? 0 : Math.round(volume * 100)}%`}
            disabled={!src} onChange={e => changeVolume(e.currentTarget.valueAsNumber / 100)} />
        </div>
        <div className="media-group media-speed">
          <button type="button" className="media-rate tabular" aria-label={t("player.resetSpeed")} title={t("player.resetSpeed")}
            disabled={!src} onClick={() => changeSpeed(1)}>{Number(speed.toFixed(1))}×</button>
          <input type="range" className="media-range" min={0.1} max={5} step={0.1} value={speed}
            aria-label={t("player.speed")} aria-valuetext={`${speed}×`} disabled={!src}
            onChange={e => changeSpeed(e.currentTarget.valueAsNumber)} />
        </div>
        <div className="media-group media-modes">
          <Control icon="repeat" label={t("player.repeat")} pressed={repeat} disabled={!ready}
            onClick={() => { setRepeat(!repeat); setLoopRange(false); }} />
          <Control icon="cut" button={trimButton} label={t("player.trim")} pressed={!!range} disabled={!ready || busy || exporting || editing}
            onClick={() => {
              if (range) closeTrim();
              else { video.current?.pause(); setRange({ start: 0, end: duration }); }
            }}>{t("player.trim")}</Control>
          <Control icon={fullscreen ? "exitFullscreen" : "fullscreen"} label={fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
            title={`${fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")} (F)`} onClick={onFullscreen} />
        </div>
      </div>
      {range && <section className="media-trim" aria-label={t("player.trim")}>
        <div className="media-trim-row">
          <button type="button" className="media-marker" aria-label={t("player.trimSetStart")} title={t("player.trimSetStart")}
            disabled={exporting || time >= range.end} onClick={() => changeRange(Math.min(video.current?.currentTime ?? time, range.end - 0.001), range.end)}>
            <b>A</b><span className="tabular">{playerTime(range.start, true)}</span>
          </button>
          <button type="button" className="media-marker" aria-label={t("player.trimSetEnd")} title={t("player.trimSetEnd")}
            disabled={exporting || time <= range.start} onClick={() => changeRange(range.start, Math.max(video.current?.currentTime ?? time, range.start + 0.001))}>
            <b>B</b><span className="tabular">{playerTime(range.end, true)}</span>
          </button>
          <span className="media-length tabular">{t("player.trimLength")} {playerTime(Math.max(0, range.end - range.start), true)}</span>
          <Control icon="repeat" label={t("player.trimLoop")} pressed={loopRange} disabled={!validRange}
            onClick={() => {
              setLoopRange(!loopRange);
              setRepeat(false);
              const player = video.current;
              if (!loopRange && player) {
                if (player.currentTime < range.start || player.currentTime >= range.end) player.currentTime = range.start;
                if (player.paused) play();
              }
            }}>A–B</Control>
        </div>
        <div className="media-trim-row media-trim-actions">
          <label className="media-trash"><input type="checkbox" checked={trash} disabled={exporting}
            onChange={e => setTrash(e.currentTarget.checked)} />{t("player.trimTrash")}</label>
          <Button disabled={exporting} onClick={closeTrim}>{t("player.trimCancel")}</Button>
          <Button variant="primary" disabled={!cutChosen || busy || exporting} onClick={async () => {
            if (await onExport(range.start, range.end, trash)) closeTrim();
          }}>{t(exporting ? "player.trimSaving" : "player.trimSaveCopy")}</Button>
        </div>
      </section>}
    </div>
  </>;
}
