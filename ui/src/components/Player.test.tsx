import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Player } from "./Player";
import { invoke } from "../lib/tauri";
import { i18n } from "../lib/i18n";
import en from "../../locales/en-US.json";

vi.mock("../lib/tauri", () => ({ convertFileSrc: (token: string) => "/" + token, invoke: vi.fn() }));

const clip = { path: "C:/Clips/Game/clip.mp4", name: "clip.mp4", game: "Game", size: 1024, created: 1_700_000_000, modified: 1_700_000_000 };
const renamed = { ...clip, name: "Final.round.mp4", path: "C:/Clips/Game/Final.round.mp4" };
const props = { clip, playbackKey: 1, onClose: vi.fn(), onDelete: vi.fn(), onRenamed: vi.fn(), onExported: vi.fn() };
const token = "playback:1";
const button = (key: keyof typeof en) => screen.getByRole("button", { name: en[key] });

beforeEach(() => {
  vi.clearAllMocks();
  i18n.lang = "en-US";
  i18n.messages = en;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "start_playback") return token as never;
    if (cmd === "resolve_playback") return clip.path as never;
    if (cmd === "rename_clip") return renamed as never;
    return undefined as never;
  });
});
afterEach(cleanup);

it("requires confirmation and releases the video before requesting deletion", async () => {
  const onDelete = vi.fn(() => expect(video.hasAttribute("src")).toBe(false));
  const { container } = render(<Player {...props} onDelete={onDelete} />);
  const video = container.querySelector("video")!;
  await waitFor(() => expect(video.getAttribute("src")).toBe("/" + token));
  fireEvent.click(button("player.delete"));
  expect(onDelete).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(video.hasAttribute("src")).toBe(true);

  fireEvent.click(button("player.deleteConfirm"));
  await waitFor(() => expect(onDelete).toHaveBeenCalledExactlyOnceWith(clip));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(video.pause).toHaveBeenCalledTimes(1);
});

it("renames the stem without reloading the video or resetting the playhead", async () => {
  const { container, rerender } = render(<Player {...props} />);
  const video = container.querySelector("video")!;
  await waitFor(() => expect(video.hasAttribute("src")).toBe(true));
  video.currentTime = 17;
  fireEvent.click(button("player.rename"));
  const name = screen.getByRole("textbox", { name: en["player.fileName"] }) as HTMLInputElement;
  expect(name.value).toBe("clip");
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "Final.round" } });
  fireEvent.click(button("player.saveName"));
  await waitFor(() => expect(props.onRenamed).toHaveBeenCalledExactlyOnceWith(clip, renamed));
  expect(invoke).toHaveBeenCalledWith("rename_clip", { path: clip.path, newStem: "Final.round" });
  rerender(<Player {...props} clip={renamed} />);
  expect(screen.getByRole("dialog", { name: renamed.name })).toBeTruthy();
  expect(video.currentTime).toBe(17);
  expect(video.play).toHaveBeenCalledTimes(1);
  expect(video.load).not.toHaveBeenCalled();
  expect(video.getAttribute("src")).toBe("/" + token);
});

it("keeps the editor and draft after a naming collision; Escape cancels only the edit", async () => {
  const { container } = render(<Player {...props} />);
  await waitFor(() => expect(container.querySelector("video")!.hasAttribute("src")).toBe(true));
  fireEvent.click(button("player.rename"));
  const name = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "taken" } });
  vi.mocked(invoke).mockResolvedValueOnce(clip.path).mockRejectedValueOnce("File already exists");
  fireEvent.click(button("player.saveName"));
  expect((await screen.findByRole("alert")).textContent).toBe("File already exists");
  expect(name.value).toBe("taken");
  fireEvent.keyDown(name, { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onRenamed).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button("player.rename"));
});

it("uses the current file location after an Explorer rename", async () => {
  const { container } = render(<Player {...props} />);
  await waitFor(() => expect(container.querySelector("video")!.hasAttribute("src")).toBe(true));
  vi.mocked(invoke).mockResolvedValueOnce(renamed.path);
  fireEvent.click(button("player.reveal"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("reveal_clip", { path: renamed.path }));
  expect(props.onRenamed).toHaveBeenCalledExactlyOnceWith(clip, renamed);
});

it("drops a late playback session after switching clips", async () => {
  let started!: (value: string) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { started = resolve as (value: string) => void; }));
  const { container, rerender } = render(<Player {...props} />);
  rerender(<Player {...props} clip={renamed} playbackKey={2} />);
  await waitFor(() => expect(container.querySelector("video")!.getAttribute("src")).toBe("/" + token));
  await act(async () => { started("stale"); });
  expect(invoke).toHaveBeenCalledWith("stop_playback", { token: "stale" });
  expect(container.querySelector("video")!.getAttribute("src")).toBe("/" + token);
});

async function renderReady(overrides: Partial<typeof props> = {}) {
  const { container } = render(<Player {...props} {...overrides} />);
  const video = container.querySelector("video")!;
  await waitFor(() => expect(button("player.reveal")).toHaveProperty("disabled", false));
  expect(video.getAttribute("src")).toBe("/" + token);
  return video;
}

async function renderTrimming(overrides: Partial<typeof props> = {}) {
  const video = await renderReady(overrides);
  Object.defineProperty(video, "duration", { configurable: true, value: 13 });
  fireEvent.durationChange(video);
  fireEvent.click(button("player.trim"));
  return video;
}

// Leave the whole-clip selection, which cannot be saved
function moveStartHandle() {
  fireEvent.keyDown(screen.getByRole("slider", { name: en["player.rangeStart"] }), { key: "ArrowRight" });
}

it("offers trimming only once the duration is known", async () => {
  const video = await renderReady();
  expect(button("player.trim")).toHaveProperty("disabled", true);
  Object.defineProperty(video, "duration", { configurable: true, value: 13 });
  fireEvent.durationChange(video);
  expect(button("player.trim")).toHaveProperty("disabled", false);
});

it("cannot save the whole clip", async () => {
  await renderTrimming();
  expect(button("player.trimSaveCopy")).toHaveProperty("disabled", true);
  moveStartHandle();
  expect(button("player.trimSaveCopy")).toHaveProperty("disabled", false);
});

it("turns off range looping when the handles span the whole clip", async () => {
  const video = await renderTrimming();
  const loop = button("player.trimLoop");
  expect(loop).toHaveProperty("disabled", true);
  moveStartHandle();
  fireEvent.click(loop);
  expect(loop.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(screen.getByRole("slider", { name: en["player.rangeStart"] }), { key: "Home" });
  expect(loop).toHaveProperty("disabled", true);
  expect(loop.getAttribute("aria-pressed")).toBe("false");
  vi.mocked(video.play).mockClear();
  fireEvent.ended(video);
  expect(video.play).not.toHaveBeenCalled();
});

it("moves either handle to the playhead", async () => {
  const video = await renderTrimming();
  Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 4 });
  fireEvent.timeUpdate(video);
  fireEvent.click(button("player.trimSetStart"));
  expect(screen.getByRole("slider", { name: en["player.rangeStart"] }).getAttribute("aria-valuenow")).toBe("4");

  video.currentTime = 9;
  fireEvent.timeUpdate(video);
  fireEvent.click(button("player.trimSetEnd"));
  expect(screen.getByRole("slider", { name: en["player.rangeEnd"] }).getAttribute("aria-valuenow")).toBe("9");
});

it("allows saving a subsecond range", async () => {
  const video = await renderTrimming();
  video.currentTime = 0.5;
  fireEvent.timeUpdate(video);
  fireEvent.click(button("player.trimSetEnd"));
  expect(button("player.trimSaveCopy")).toHaveProperty("disabled", false);
});

it.each([false, true])("sends the precise range and requested recycle flag (%s) with the open session", async trashOriginal => {
  const video = await renderTrimming();
  const checkbox = screen.getByRole("checkbox", { name: en["player.trimTrash"] });
  expect(checkbox).toHaveProperty("checked", false);
  if (trashOriginal) fireEvent.click(checkbox);
  const result = { clip: renamed, originalTrashed: trashOriginal, trashError: null };
  vi.mocked(invoke).mockResolvedValueOnce(result);
  moveStartHandle();
  fireEvent.click(button("player.trimSaveCopy"));
  await waitFor(() => expect(props.onExported).toHaveBeenCalledWith(result));
  expect(invoke).toHaveBeenCalledWith("export_clip_range", { token, path: clip.path, startSeconds: 0.1, endSeconds: 13, trashOriginal });
  expect(screen.getByRole("status").textContent).toContain(renamed.name);
  expect(props.onClose).not.toHaveBeenCalled();
  expect(video.getAttribute("src")).toBe("/" + token);
});

it("reports a saved trim and recycle failure as a partial success", async () => {
  await renderTrimming();
  fireEvent.click(screen.getByRole("checkbox"));
  const result = { clip: renamed, originalTrashed: false, trashError: "locked file" };
  vi.mocked(invoke).mockResolvedValueOnce(result);
  moveStartHandle();
  fireEvent.click(button("player.trimSaveCopy"));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(renamed.name);
  expect(alert.textContent).toContain(result.trashError);
  expect(props.onExported).toHaveBeenCalledWith(result);
});

it("shows a late export failure in the gallery and lets the user dismiss it", async () => {
  const { container, rerender } = render(<Player {...props} />);
  const video = container.querySelector("video")!;
  await waitFor(() => expect(video.hasAttribute("src")).toBe(true));
  Object.defineProperty(video, "duration", { configurable: true, value: 13 });
  fireEvent.durationChange(video);
  fireEvent.click(button("player.trim"));
  moveStartHandle();
  let fail!: (reason: string) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  fireEvent.click(button("player.trimSaveCopy"));
  rerender(<Player {...props} clip={null} />);
  await act(async () => { fail("disk full"); });
  expect(screen.getByRole("status").textContent).toContain("clip.mp4 · disk full");
  fireEvent.click(button("player.dismissStatus"));
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps the clip, selection and file actions consistent after a failed export", async () => {
  const video = await renderTrimming();
  vi.mocked(invoke).mockRejectedValueOnce("no space");
  moveStartHandle();
  fireEvent.click(button("player.trimSaveCopy"));
  expect((await screen.findByRole("alert")).textContent).toBe("no space");
  expect(video.getAttribute("src")).toBe("/" + token);
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onExported).not.toHaveBeenCalled();
  expect(screen.getByRole("slider", { name: en["player.rangeStart"] }).getAttribute("aria-valuenow")).toBe("0.1");
});

it("uses one button for play and pause and keeps the position on pause", async () => {
  const video = await renderReady();
  Object.defineProperty(video, "duration", { configurable: true, value: 13 });
  fireEvent.durationChange(video);
  const paused = vi.spyOn(video, "paused", "get").mockReturnValue(true);
  const transport = button("player.play");
  const playIcon = transport.querySelector("svg")!.innerHTML;
  expect(screen.queryByRole("button", { name: en["player.pause"] })).toBeNull();
  vi.mocked(video.play).mockClear();
  fireEvent.click(transport);
  expect(video.play).toHaveBeenCalledOnce();
  paused.mockReturnValue(false);
  fireEvent.play(video);
  expect(button("player.pause")).toBe(transport);
  expect(screen.queryByRole("button", { name: en["player.play"] })).toBeNull();
  expect(transport.querySelector("svg")!.innerHTML).not.toBe(playIcon);

  vi.mocked(video.pause).mockClear();
  video.currentTime = 7;
  fireEvent.click(transport);
  expect(video.pause).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(7);
  paused.mockReturnValue(true);
  fireEvent.pause(video);
  expect(button("player.play")).toBe(transport);
  expect(transport.querySelector("svg")!.innerHTML).toBe(playIcon);
  fireEvent.click(transport);
  expect(video.play).toHaveBeenCalledTimes(2);
  expect(video.currentTime).toBe(7);
  fireEvent.play(video);
  video.currentTime = video.duration;
  vi.spyOn(video, "ended", "get").mockReturnValue(true);
  fireEvent.ended(video);
  expect(button("player.play")).toBe(transport);
  fireEvent.click(transport);
  expect(video.currentTime).toBe(0);
});

it("puts the available clip navigation buttons beside the picture", async () => {
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const { container, rerender } = render(<Player {...props} onPrevious={onPrevious} onNext={onNext} />);
  const video = container.querySelector("video")!;
  await waitFor(() => expect(video.hasAttribute("src")).toBe(true));
  const picture = video.closest(".media-picture")!;
  expect(picture.contains(button("player.previous"))).toBe(true);
  expect(picture.contains(button("player.next"))).toBe(true);
  vi.mocked(video.play).mockClear();
  fireEvent.click(button("player.previous"));
  fireEvent.click(button("player.next"));
  expect(onPrevious).toHaveBeenCalledOnce();
  expect(onNext).toHaveBeenCalledOnce();
  expect(video.play).not.toHaveBeenCalled();
  expect(video.pause).not.toHaveBeenCalled();

  rerender(<Player {...props} onNext={onNext} />);
  expect(screen.queryByRole("button", { name: en["player.previous"] })).toBeNull();
  expect(picture.contains(button("player.next"))).toBe(true);
  rerender(<Player {...props} onPrevious={onPrevious} />);
  expect(screen.queryByRole("button", { name: en["player.next"] })).toBeNull();
  expect(picture.contains(button("player.previous"))).toBe(true);
});

it("toggles playback with Space, in and out of trimming", async () => {
  const video = await renderReady();
  const paused = vi.spyOn(video, "paused", "get").mockReturnValue(true);
  vi.mocked(video.play).mockClear();

  expect(fireEvent.keyDown(document, { key: " " })).toBe(false);
  expect(video.play).toHaveBeenCalledOnce();

  paused.mockReturnValue(false);
  video.currentTime = 4;
  fireEvent.keyDown(document, { key: " " });
  expect(video.pause).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(4);

  fireEvent.keyDown(document, { key: " ", repeat: true });
  expect(video.pause).toHaveBeenCalledOnce();

  Object.defineProperty(video, "duration", { configurable: true, value: 13 });
  fireEvent.durationChange(video);
  fireEvent.click(button("player.trim"));
  paused.mockReturnValue(true);
  vi.mocked(video.play).mockClear();
  fireEvent.keyDown(document, { key: " " });
  expect(video.play).toHaveBeenCalledOnce();
});

it("keeps Space from reaching the focused video's own controls", async () => {
  const video = await renderReady();
  vi.spyOn(video, "paused", "get").mockReturnValue(false);
  const native = vi.fn();
  video.addEventListener("keydown", native);
  video.addEventListener("keyup", native);
  fireEvent.keyDown(video, { key: " " });
  fireEvent.keyUp(video, { key: " " });
  expect(video.pause).toHaveBeenCalledOnce();
  expect(native).not.toHaveBeenCalled();
});

it("types a space into the file name instead of toggling playback", async () => {
  const video = await renderReady();
  vi.mocked(video.play).mockClear();
  fireEvent.click(button("player.rename"));
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: " " })).toBe(true);
  expect(video.play).not.toHaveBeenCalled();
});

it("ignores Space when the player is closed", () => {
  render(<Player {...props} clip={null} />);
  expect(fireEvent.keyDown(document, { key: " " })).toBe(true);
});

it("leaves trimming on Escape without closing the player", async () => {
  await renderTrimming();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("slider", { name: en["player.rangeStart"] })).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("applies speed endpoints, resets to normal speed, and restores volume after muting", async () => {
  const video = await renderReady();
  const speed = screen.getByRole("slider", { name: en["player.speed"] });
  fireEvent.change(speed, { target: { value: "0.1" } });
  expect(video.playbackRate).toBe(0.1);
  fireEvent.change(speed, { target: { value: "5" } });
  expect(video.playbackRate).toBe(5);
  fireEvent.click(button("player.resetSpeed"));
  expect(video.playbackRate).toBe(1);
  fireEvent.change(screen.getByRole("slider", { name: en["player.volume"] }), { target: { value: "45" } });
  expect(video.volume).toBe(0.45);
  fireEvent.click(button("player.mute"));
  expect(video.muted).toBe(true);
  fireEvent.click(button("player.unmute"));
  expect(video.muted).toBe(false);
  expect(video.volume).toBe(0.45);
});

it("jumps five seconds and clamps to both clip bounds", async () => {
  const video = await renderReady();
  Object.defineProperty(video, "duration", { configurable: true, value: 8 });
  fireEvent.durationChange(video);
  fireEvent.click(button("player.forwardFive"));
  expect(video.currentTime).toBe(5);
  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(video.currentTime).toBe(8);
  fireEvent.click(button("player.backFive"));
  expect(video.currentTime).toBe(3);
  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(video.currentTime).toBe(0);
});

it("loops only the selected range and leaves the clip stopped at the end otherwise", async () => {
  const video = await renderTrimming();
  expect(screen.queryByRole("button", { name: "Loop clip" })).toBeNull();
  video.currentTime = 3;
  fireEvent.timeUpdate(video);
  fireEvent.click(button("player.trimSetStart"));
  video.currentTime = 5;
  fireEvent.timeUpdate(video);
  fireEvent.click(button("player.trimSetEnd"));
  vi.mocked(video.play).mockClear();
  fireEvent.click(button("player.trimLoop"));
  expect(video.loop).toBe(false);
  expect(video.play).toHaveBeenCalledOnce();
  vi.spyOn(video, "paused", "get").mockReturnValue(false);
  fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(3);
  fireEvent.click(button("player.trimLoop"));
  video.currentTime = 6;
  fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(6);
  vi.mocked(video.play).mockClear();
  video.currentTime = video.duration;
  fireEvent.ended(video);
  expect(video.currentTime).toBe(video.duration);
  expect(video.play).not.toHaveBeenCalled();
});

it("requests fullscreen on the stable player shell and dismisses it before closing the dialog", async () => {
  const video = await renderReady();
  const shell = video.closest<HTMLElement>(".player-shell")!;
  const request = vi.fn().mockResolvedValue(undefined);
  const exit = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(shell, "requestFullscreen", { configurable: true, value: request });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  try {
    fireEvent.click(button("player.fullscreen"));
    expect(request).toHaveBeenCalledOnce();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: shell });
    fireEvent(document, new Event("fullscreenchange"));
    expect(button("player.exitFullscreen")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(exit).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  }
});
