import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { cx, formatDuration } from "../lib/format";
import { t } from "../lib/i18n";
import { MIN_TRIM_SECONDS } from "../lib/trim";

const KEY_STEP = 0.1;

interface Props {
  duration: number;
  start: number;
  end: number;
  time: number;
  disabled: boolean;
  onStart: (seconds: number) => void;
  onEnd: (seconds: number) => void;
  onSeek: (seconds: number) => void;
}

// A handle's bracket icon: the solid line is the handle, the dashed box the part it keeps.
function SnapIcon({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("size-[18px]", flip && "-scale-x-100")} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M8 3v14" strokeLinecap="round" />
      <path d="M11 4h5v12h-5" strokeDasharray="2 2" />
    </svg>
  );
}

export function Trimmer({ duration, start, end, time, disabled, onStart, onEnd, onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<((seconds: number) => void) | null>(null);
  const percent = (seconds: number) => `${(seconds / duration) * 100}%`;

  const at = (e: PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return (Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))) * duration;
  };

  const grab = (move: (seconds: number) => void) => (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = move;
    move(at(e));
  };
  const onMove = (e: PointerEvent) => drag.current?.(at(e));
  const release = () => { drag.current = null; };

  const nudge = (value: number, move: (seconds: number) => void) => (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    move(value + (e.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP));
  };

  const handle = (label: string, value: number, move: (seconds: number) => void, side: "start" | "end") => (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={formatDuration(value)}
      aria-disabled={disabled}
      style={{ left: percent(value) }}
      className={cx(
        "absolute inset-y-0 z-10 grid w-3.5 cursor-ew-resize touch-none place-items-center bg-white focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus)]",
        side === "start" ? "-translate-x-full rounded-l-md" : "rounded-r-md",
      )}
      onPointerDown={grab(move)}
      onKeyDown={disabled ? undefined : nudge(value, move)}
    >
      <span className="h-4 w-0.5 rounded bg-black/60" />
    </div>
  );

  const snapButton = "grid size-8 place-items-center rounded-full enabled:hover:bg-white/15 disabled:opacity-30";

  return (
    <div className="px-3.5 pt-12">
      <div
        ref={track}
        role="group"
        aria-label={t("player.trimTimeline")}
        className="relative h-11 cursor-pointer touch-none rounded-sm bg-panel-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
        onPointerDown={grab(onSeek)}
        onPointerMove={onMove}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div
          className="absolute inset-y-0 border-y-2 border-white bg-accent/30"
          style={{ left: percent(start), right: `${100 - ((end / duration) * 100)}%` }}
        />
        {handle(t("player.trimStart"), start, onStart, "start")}
        {handle(t("player.trimEnd"), end, onEnd, "end")}
        <div className="pointer-events-none absolute -inset-y-1 z-20 w-0.5 -translate-x-1/2 rounded bg-white shadow-[0_0_4px_rgba(0,0,0,.6)]" style={{ left: percent(time) }} />
        <div
          className="absolute bottom-full z-20 mb-2 flex -translate-x-1/2 gap-0.5 rounded-full bg-panel-2 p-0.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
          style={{ left: `clamp(36px, ${percent(time)}, calc(100% - 36px))` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={snapButton}
            title={t("player.trimSetStart")}
            aria-label={t("player.trimSetStart")}
            disabled={disabled || time > end - MIN_TRIM_SECONDS}
            onClick={() => onStart(time)}
          >
            <SnapIcon />
          </button>
          <button
            type="button"
            className={snapButton}
            title={t("player.trimSetEnd")}
            aria-label={t("player.trimSetEnd")}
            disabled={disabled || time < start + MIN_TRIM_SECONDS}
            onClick={() => onEnd(time)}
          >
            <SnapIcon flip />
          </button>
        </div>
      </div>
    </div>
  );
}
