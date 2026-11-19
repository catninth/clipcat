/** Elapsed media time. Keep subsecond boundaries visible even in short selections. */
export function playerTime(seconds: number, precise = false): string {
  const raw = Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000;
  const milliseconds = precise ? Math.round(raw) : Math.floor(raw);
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const clock = hours ? `${hours}:${String(minutes).padStart(2, "0")}` : String(minutes);
  const whole = `${clock}:${String(total % 60).padStart(2, "0")}`;
  return precise ? `${whole}.${String(milliseconds % 1000).padStart(3, "0")}` : whole;
}
