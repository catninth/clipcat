import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { t } from "../lib/i18n";
import { playerTime } from "../lib/playerTime";
import "./PlayerTimeline.css";

type Handle = "playhead" | "start" | "end";
interface Props {
  src: string | null;
  duration: number;
  time: number;
  buffered?: number;
  range?: { start: number; end: number };
  onSeek: (seconds: number) => void;
  onRangeChange?: (start: number, end: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function PlayerTimeline({ src, duration, time, buffered = 0, range, onSeek, onRangeChange, onScrubStart, onScrubEnd }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; handle: Handle; offset: number } | null>(null);
  const hoverFrame = useRef<number | null>(null);
  const hoverTarget = useRef(0);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const enabled = !!src && length > 0;
  const percent = (seconds: number) => `${length ? 100 * clamp(seconds / length, 0, 1) : 0}%`;
  const start = dragging === "start" && hover !== null ? hover : range?.start;
  const end = dragging === "end" && hover !== null ? hover : range?.end;
  const playhead = dragging === "playhead" && hover !== null ? hover : clamp(time, 0, length);

  function cancelHoverFrame() {
    if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = null;
  }
  useEffect(() => cancelHoverFrame, [src]);

  function limit(target: number, handle: Handle) {
    if (range && handle === "start") return clamp(target, 0, Math.max(0, range.end - 0.001));
    if (range && handle === "end") return clamp(target, Math.min(length, range.start + 0.001), length);
    return clamp(target, 0, length);
  }

  function pointerTime(clientX: number) {
    const rect = track.current!.getBoundingClientRect();
    return rect.width ? (clientX - rect.left) / rect.width * length : 0;
  }

  function commit(handle: Handle, value: number) {
    if (handle === "playhead") onSeek(value);
    else if (range && onRangeChange) {
      if (handle === "start") onRangeChange(value, range.end);
      else onRangeChange(range.start, value);
    }
  }

  function begin(e: PointerEvent<HTMLElement>, handle: Handle) {
    if (!enabled || e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    cancelHoverFrame();
    const at = pointerTime(e.clientX);
    const offset = handle !== "playhead" && range ? range[handle] - at : 0;
    drag.current = { id: e.pointerId, handle, offset };
    track.current?.setPointerCapture?.(e.pointerId);
    setDragging(handle);
    setHover(limit(at + offset, handle));
    if (handle === "playhead") onScrubStart?.();
  }

  function finish(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    if (!current || e.pointerId !== current.id) return;
    drag.current = null;
    setDragging(null);
    cancelHoverFrame();
    const value = limit(pointerTime(e.clientX) + current.offset, current.handle);
    if (!cancelled) commit(current.handle, value);
    if (current.handle === "playhead") onScrubEnd?.();
    const rect = e.currentTarget.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    setHover(!cancelled && e.pointerType !== "touch" && inside ? value : null);
  }

  function keyDown(e: KeyboardEvent<HTMLElement>, handle: Handle, value: number) {
    const small = handle === "playhead" ? 5 : (e.shiftKey ? 0.01 : 0.1);
    let target: number;
    switch (e.key) {
      case "ArrowLeft": case "ArrowDown": target = value - small; break;
      case "ArrowRight": case "ArrowUp": target = value + small; break;
      case "PageDown": target = value - Math.max(small, length / 10); break;
      case "PageUp": target = value + Math.max(small, length / 10); break;
      case "Home": target = 0; break;
      case "End": target = length; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    commit(handle, limit(target, handle));
    setHover(null);
  }

  return (
    <div className="player-timeline" ref={track}
      onPointerMove={e => {
        if (!enabled || (drag.current && drag.current.id !== e.pointerId)) return;
        if (!drag.current && e.pointerType === "touch") return;
        hoverTarget.current = limit(pointerTime(e.clientX) + (drag.current?.offset ?? 0), drag.current?.handle ?? "playhead");
        if (hoverFrame.current === null) {
          hoverFrame.current = requestAnimationFrame(() => {
            hoverFrame.current = null;
            setHover(hoverTarget.current);
          });
        }
      }}
      onPointerLeave={() => { if (!drag.current) { cancelHoverFrame(); setHover(null); } }}
      onPointerUp={e => finish(e, false)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}>
      <div className="timeline-rail" aria-hidden="true">
        <i className="timeline-buffer" style={{ width: percent(buffered) }} />
        <i className="timeline-elapsed" style={{ width: percent(playhead) }} />
        {start !== undefined && end !== undefined && (
          <i className="timeline-selection" style={{ left: percent(start), width: percent(end - start) }} />
        )}
        <i className="timeline-thumb" style={{ left: percent(playhead) }} />
      </div>
      <input type="range" className="timeline-seek" disabled={!enabled} aria-label={t("player.timeline")}
        aria-valuetext={playerTime(playhead, true)} min={0} max={length} step="any" value={playhead}
        onPointerDown={e => begin(e, "playhead")} onKeyDown={e => keyDown(e, "playhead", playhead)}
        onChange={e => { if (!drag.current) onSeek(Number(e.currentTarget.value)); }} />
      {range && (["start", "end"] as const).map(handle => {
        const seconds = handle === "start" ? start! : end!;
        const label = t(handle === "start" ? "player.rangeStart" : "player.rangeEnd");
        return (
          <button key={handle} type="button" role="slider" disabled={!enabled || !onRangeChange}
            className={`timeline-marker timeline-marker-${handle}`} style={{ left: percent(seconds) }}
            aria-label={label} aria-valuenow={seconds} aria-valuetext={playerTime(seconds, true)}
            aria-valuemin={limit(0, handle)} aria-valuemax={limit(length, handle)}
            title={`${label} · ${playerTime(seconds, true)}`}
            onPointerDown={e => begin(e, handle)} onKeyDown={e => keyDown(e, handle, seconds)}>
            <span aria-hidden="true">{handle === "start" ? "A" : "B"}</span>
          </button>
        );
      })}
      {src && enabled && hover !== null && (
        <FramePreview key={src} src={src} time={hover} position={percent(hover)} />
      )}
    </div>
  );
}

function FramePreview({ src, time, position }: { src: string; time: number; position: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const decoder = useRef<HTMLVideoElement>(null);
  const request = useRef<((time: number) => void) | null>(null);
  useEffect(() => {
    const frame = canvas.current!;
    const label = caption.current!;
    let video: HTMLVideoElement | null = null;
    let desired = 0;
    let rendered = -1;
    let inFlight: number | null = null;
    let openTimer = 0;
    let idleTimer = 0;
    let loadTimer = 0;
    let failed = false;

    function release() {
      clearTimeout(openTimer);
      clearTimeout(idleTimer);
      clearTimeout(loadTimer);
      openTimer = 0;
      inFlight = null;
      if (!video) return;
      video.onloadeddata = video.onloadedmetadata = video.onseeked = video.onerror = null;
      video.removeAttribute("src");
      video.load();
      video = null;
    }

    function fail() {
      failed = true;
      frame.hidden = true;
      label.textContent = playerTime(desired, true);
      release();
    }

    function draw(at: number) {
      if (!video || !video.videoWidth || !video.videoHeight) return;
      const ctx = frame.getContext("2d");
      if (!ctx) { fail(); return; }
      const scale = Math.min(frame.width / video.videoWidth, frame.height / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      try {
        ctx.clearRect(0, 0, frame.width, frame.height);
        ctx.drawImage(video, (frame.width - w) / 2, (frame.height - h) / 2, w, h);
      } catch { fail(); return; }
      frame.hidden = false;
      rendered = at;
      label.textContent = playerTime(at, true);
      clearTimeout(loadTimer);
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(release, 1500);
    }

    function seek() {
      if (!video || inFlight !== null || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      // At the right edge request the final displayable sample, before end-of-stream.
      const at = Math.min(desired, Math.max(0, video.duration - 0.000001));
      if (!Number.isFinite(at)) return;
      if (Math.abs(video.currentTime - at) < 0.000001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (rendered !== desired) draw(desired);
        return;
      }
      clearTimeout(idleTimer);
      clearTimeout(loadTimer);
      loadTimer = window.setTimeout(fail, 8000);
      inFlight = desired;
      try { video.currentTime = at; } catch { fail(); }
    }

    function open() {
      openTimer = 0;
      video = decoder.current!;
      video.onloadedmetadata = video.onloadeddata = seek;
      video.onseeked = () => {
        const at = inFlight;
        inFlight = null;
        // Keep the image and its caption together while coalescing a pointer sweep.
        if (at !== null) draw(at);
        if (at !== desired) seek();
      };
      video.onerror = fail;
      loadTimer = window.setTimeout(fail, 8000);
      video.src = src;
    }

    request.current = target => {
      desired = target;
      if (frame.hidden) label.textContent = playerTime(target, true);
      if (failed || target === rendered && !video) return;
      if (video) seek();
      else if (!openTimer) openTimer = window.setTimeout(open, 75);
    };
    return () => { request.current = null; release(); };
  }, [src]);

  useEffect(() => { request.current?.(time); }, [src, time]);
  return (
    <div className="timeline-preview" style={{ left: `clamp(min(80px, 50%), ${position}, max(50%, 100% - 80px))` }} aria-hidden="true">
      <video ref={decoder} className="timeline-decoder" muted playsInline crossOrigin="anonymous" preload="metadata" />
      <canvas ref={canvas} width={288} height={162} hidden />
      <span ref={caption} className="timeline-preview-time" />
    </div>
  );
}
