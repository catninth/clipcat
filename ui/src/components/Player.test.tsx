import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Player } from "./Player";
import { invoke } from "../lib/tauri";
import { i18n } from "../lib/i18n";
import en from "../../locales/en-US.json";

vi.mock("../lib/tauri", () => ({ convertFileSrc: (token: string) => "/" + token, invoke: vi.fn() }));

const clip = { path: "C:/Clips/Game/clip.mp4", name: "clip.mp4", game: "Game", size: 1024, created: 1_700_000_000, modified: 1_700_000_000 };
const renamed = { ...clip, name: "Final.round.mp4", path: "C:/Clips/Game/Final.round.mp4" };
const props = { clip, playbackKey: 1, onClose: vi.fn(), onDelete: vi.fn(), onRenamed: vi.fn() };
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
