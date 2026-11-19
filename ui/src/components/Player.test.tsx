import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Player } from "./Player";
import { invoke } from "../lib/tauri";
import { i18n } from "../lib/i18n";
import en from "../../locales/en-US.json";

vi.mock("../lib/tauri", () => ({ convertFileSrc: (token: string) => "/" + token, invoke: vi.fn() }));

const clip = { path: "C:/Clips/Game/clip.mp4", name: "clip.mp4", game: "Game", size: 1024, created: 1_700_000_000, modified: 1_700_000_000 };
const renamed = { ...clip, name: "Final.round.mp4", path: "C:/Clips/Game/Final.round.mp4" };
const props = { clip, playbackKey: 1, onClose: vi.fn(), onDelete: vi.fn(), onRenamed: vi.fn(), onTrimmed: vi.fn() };
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
  fireEvent.keyDown(screen.getByRole("slider", { name: en["player.trimStart"] }), { key: "ArrowRight" });
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
  expect(button("player.trimReplace")).toHaveProperty("disabled", true);
  moveStartHandle();
  expect(button("player.trimSaveCopy")).toHaveProperty("disabled", false);
});

it("moves either handle to the playhead", async () => {
  const video = await renderTrimming();
  Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 4 });
  await waitFor(() => expect(screen.getByText("00:04 / 00:13")).toBeTruthy());
  fireEvent.click(button("player.trimSetStart"));
  expect(screen.getByRole("slider", { name: en["player.trimStart"] }).getAttribute("aria-valuenow")).toBe("4");

  video.currentTime = 9;
  await waitFor(() => expect(screen.getByText("00:09 / 00:13")).toBeTruthy());
  fireEvent.click(button("player.trimSetEnd"));
  expect(screen.getByRole("slider", { name: en["player.trimEnd"] }).getAttribute("aria-valuenow")).toBe("9");
});

it("disables a snap that would leave less than a second", async () => {
  const video = await renderTrimming();
  Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0.5 });
  await waitFor(() => expect(button("player.trimSetEnd")).toHaveProperty("disabled", true));
  expect(button("player.trimSetStart")).toHaveProperty("disabled", false);
});

it("saves a copy of the current file location, then closes", async () => {
  const video = await renderTrimming();
  vi.mocked(invoke).mockResolvedValueOnce(renamed.path).mockResolvedValueOnce(renamed.path);
  moveStartHandle();
  fireEvent.click(button("player.trimSaveCopy"));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("trim_clip", { path: renamed.path, start: 0.1, end: 13, replace: false });
  expect(props.onTrimmed).toHaveBeenCalledOnce();
  expect(video.hasAttribute("src")).toBe(false);
});

it("requires confirmation before replacing the original", async () => {
  await renderTrimming();
  moveStartHandle();
  fireEvent.click(button("player.trimReplace"));
  expect(invoke).not.toHaveBeenCalledWith("trim_clip", expect.anything());
  fireEvent.click(button("player.trimReplaceConfirm"));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("trim_clip", { path: clip.path, start: 0.1, end: 13, replace: true });
});

it("keeps playing the clip and the selection after a failed trim", async () => {
  const video = await renderTrimming();
  vi.mocked(invoke).mockResolvedValueOnce(clip.path).mockRejectedValueOnce("no space");
  moveStartHandle();
  fireEvent.click(button("player.trimSaveCopy"));
  expect((await screen.findByRole("alert")).textContent).toBe("no space");
  expect(video.getAttribute("src")).toBe("/" + token);
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onTrimmed).not.toHaveBeenCalled();
  expect(screen.getByRole("slider", { name: en["player.trimStart"] }).getAttribute("aria-valuenow")).toBe("0.1");
});

it("plays and pauses from the icon button", async () => {
  const video = await renderTrimming();
  vi.mocked(video.play).mockClear();
  fireEvent.click(button("player.trimPlay"));
  expect(video.play).toHaveBeenCalledOnce();
  fireEvent.play(video);
  expect(button("player.trimPause")).toBeTruthy();
});

it("toggles playback with Space, in and out of trimming", async () => {
  const video = await renderReady();
  const paused = vi.spyOn(video, "paused", "get").mockReturnValue(true);
  vi.mocked(video.play).mockClear();

  expect(fireEvent.keyDown(document, { key: " " })).toBe(false);
  expect(video.play).toHaveBeenCalledOnce();

  paused.mockReturnValue(false);
  fireEvent.keyDown(document, { key: " " });
  expect(video.pause).toHaveBeenCalledOnce();

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
  expect(screen.queryByRole("slider", { name: en["player.trimStart"] })).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledOnce();
});
