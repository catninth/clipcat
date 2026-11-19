import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../locales/en-US.json";
import { i18n } from "../lib/i18n";
import { PlayerTimeline } from "./PlayerTimeline";

const src = "/playback:one";
const rect = { x: 10, left: 10, y: 5, top: 5, bottom: 37, right: 210, width: 200, height: 32, toJSON() {} };
const pointer = (x: number) => ({ clientX: x, clientY: 15, pointerId: 1, pointerType: "mouse", button: 0 });

beforeEach(() => {
  i18n.messages = en;
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function setup(range?: { start: number; end: number }) {
  const props = { src, duration: 100, time: 12, range, onSeek: vi.fn(), onRangeChange: vi.fn(), onScrubStart: vi.fn(), onScrubEnd: vi.fn() };
  const view = render(<PlayerTimeline {...props} />);
  const slider = screen.getByRole("slider", { name: en["player.timeline"] });
  const track = slider.parentElement!;
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { ...view, props, slider, track };
}

function decoder() {
  const setSrc = vi.spyOn(HTMLMediaElement.prototype, "src", "set");
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ drawImage: draw, clearRect: vi.fn() }) as unknown as CanvasRenderingContext2D);
  function ready() {
    const video = setSrc.mock.instances[0] as HTMLVideoElement;
    Object.defineProperties(video, {
      readyState: { value: 2 }, duration: { value: 100 },
      videoWidth: { value: 1920 }, videoHeight: { value: 1080 },
    });
    fireEvent.loadedMetadata(video);
    return video;
  }
  return { setSrc, draw, ready };
}

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

it("opens the decoder on demand, combines pending seeks, and leaves the playhead alone", () => {
  const { track, props } = setup();
  const { setSrc, draw, ready } = decoder();
  fireEvent.pointerMove(track, pointer(30));
  advance(30);
  expect(setSrc).not.toHaveBeenCalled();
  advance(80);
  expect(setSrc).toHaveBeenCalledExactlyOnceWith(src);
  const video = ready();
  expect(video.muted).toBe(true);
  expect(video.isConnected).toBe(true);
  expect(video.preload).toBe("metadata");
  expect(video.currentTime).toBe(10);
  fireEvent.pointerMove(track, pointer(60));
  advance(20);
  fireEvent.pointerMove(track, pointer(90));
  advance(20);
  expect(video.currentTime).toBe(10);
  fireEvent.seeked(video);
  expect(video.currentTime).toBe(40);
  fireEvent.seeked(video);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(track.querySelector("canvas")!.hidden).toBe(false);
  expect(track.querySelector(".timeline-preview-time")!.textContent).toBe("0:40.000");
  expect(props.onSeek).not.toHaveBeenCalled();
  advance(1600);
  expect(video.hasAttribute("src")).toBe(false);
  expect(video.onseeked).toBeNull();
  expect(track.querySelector("canvas")!.hidden).toBe(false);
});

it("releases a pending decode on clip change and keeps a timestamp if decoding fails", () => {
  const { props, track, rerender } = setup();
  const { ready, setSrc, draw } = decoder();
  fireEvent.pointerMove(track, pointer(60));
  advance(20);
  advance(100);
  const old = ready();
  rerender(<PlayerTimeline {...props} src="/playback:two" />);
  expect(old.hasAttribute("src")).toBe(false);
  fireEvent.seeked(old);
  expect(draw).not.toHaveBeenCalled();
  advance(100);
  const next = setSrc.mock.instances[1] as HTMLVideoElement;
  fireEvent.error(next);
  expect(next.hasAttribute("src")).toBe(false);
  fireEvent.pointerMove(track, pointer(90));
  advance(20);
  expect(track.querySelector(".timeline-preview-time")!.textContent).toBe("0:40.000");
  fireEvent.pointerLeave(track);
  expect(track.querySelector("canvas")).toBeNull();
});

it("commits one seek on release, honors pointer cancellation and supports keyboard seek", () => {
  const { track, slider, props } = setup();
  fireEvent.pointerDown(slider, pointer(30));
  fireEvent.pointerMove(track, pointer(150));
  expect(props.onSeek).not.toHaveBeenCalled();
  fireEvent.pointerUp(track, pointer(250));
  expect(props.onSeek).toHaveBeenCalledExactlyOnceWith(100);
  expect(props.onScrubStart).toHaveBeenCalledOnce();
  expect(props.onScrubEnd).toHaveBeenCalledOnce();
  fireEvent.pointerDown(slider, pointer(30));
  fireEvent.pointerCancel(track, pointer(45));
  expect(props.onSeek).toHaveBeenCalledTimes(1);
  expect(props.onScrubEnd).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(props.onSeek).toHaveBeenLastCalledWith(17);
  fireEvent.keyDown(slider, { key: "Home" });
  expect(props.onSeek).toHaveBeenLastCalledWith(0);
});

it("allows subsecond A/B changes and keeps both handles on their own side", () => {
  const { track, props } = setup({ start: 20, end: 30 });
  const a = screen.getByRole("slider", { name: en["player.rangeStart"] });
  const b = screen.getByRole("slider", { name: en["player.rangeEnd"] });
  fireEvent.pointerDown(a, pointer(50));
  fireEvent.pointerUp(track, pointer(205));
  expect(props.onRangeChange).toHaveBeenLastCalledWith(29.999, 30);
  fireEvent.keyDown(b, { key: "ArrowLeft", shiftKey: true });
  expect(props.onRangeChange).toHaveBeenLastCalledWith(20, 29.99);
  expect(props.onSeek).not.toHaveBeenCalled();
  expect(props.onScrubStart).not.toHaveBeenCalled();
});
