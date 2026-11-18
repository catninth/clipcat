// Matches MIN_LENGTH in src-tauri/src/trim.rs
export const MIN_TRIM_SECONDS = 1;

export const canTrim = (duration: number) => isFinite(duration) && duration >= MIN_TRIM_SECONDS;

export const clampStart = (time: number, end: number) => Math.max(0, Math.min(time, end - MIN_TRIM_SECONDS));

export const clampEnd = (time: number, start: number, duration: number) =>
  Math.min(duration, Math.max(time, start + MIN_TRIM_SECONDS));

// The handles can sit a hair off the edges after dragging; that still means the whole clip.
export const isWholeClip = (start: number, end: number, duration: number) => start < 0.01 && end > duration - 0.01;
