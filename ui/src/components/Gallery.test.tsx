import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { i18n } from "../lib/i18n";
import { invoke } from "../lib/tauri";
import type { Clip } from "../lib/tauri";
import { cachedDuration } from "../lib/thumbs";
import en from "../../locales/en-US.json";

let library: Clip[];
vi.mock("../lib/tauri", () => ({
  invoke: vi.fn(), listen: async () => () => {}, convertFileSrc: (path: string) => path,
}));
vi.mock("../lib/thumbs", () => ({
  getThumb: () => undefined, cachedDuration: vi.fn(), requestThumb: () => () => {}, tileKey: (c: Clip) => c.path,
  previewTime: () => 0, pruneThumbs: vi.fn(), thumbsReady: Promise.resolve(),
}));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./Player", () => ({
  Player: ({ clip, playbackKey, onPrevious, onNext, onClose, onRenamed }: {
    clip: Clip | null; playbackKey: number; onPrevious?: () => void; onNext?: () => void;
    onClose: () => void; onRenamed: (previous: Clip, updated: Clip) => void;
  }) => clip && <div role="dialog">
    <output>{clip.name} #{playbackKey}</output>
    {onPrevious && <button onClick={onPrevious}>Previous clip</button>}
    {onNext && <button onClick={onNext}>Next clip</button>}
    <button onClick={onClose}>Close</button>
    <button onClick={() => {
      const updated = { ...clip, path: "C:/Clips/Game/zzz.mp4", name: "zzz.mp4" };
      library = library.map(c => c.path === clip.path ? updated : c);
      onRenamed(clip, updated);
    }}>Rename</button>
  </div>,
}));

function clip(n: number, game = "Game"): Clip {
  return {
    path: `C:/Clips/${game}/clip-${n}.mp4`, name: `clip-${n}.mp4`, game,
    size: n * 1024, modified: 1_700_000_000 + n, created: 1_700_000_000 - n,
  };
}
const button = (text: string) => screen.getByRole("button", { name: text });
const shown = () => screen.getAllByTitle(/\.mp4$/).map(tile => tile.title);
beforeEach(() => {
  i18n.lang = "en-US"; i18n.messages = en;
  vi.mocked(invoke).mockImplementation(async command => (command === "list_clips" ? library : null) as never);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("allows opening the 501st clip without rendering all tiles at once (audit 16)", async () => {
  library = Array.from({ length: 501 }, (_, n) => clip(n));
  render(<App />);
  await screen.findByTitle("clip-0.mp4");
  expect(screen.queryByTitle("clip-500.mp4")).toBeNull();
  for (let page = 1; page < 9; page++) fireEvent.click(button(en["gallery.next"]));
  fireEvent.click(screen.getByTitle("clip-500.mp4"));
  expect(screen.getByRole("dialog").textContent).toContain("clip-500.mp4");
  expect(screen.queryByTitle("clip-0.mp4")).toBeNull();
});

it("sorts both directions for filename, creation time, size and length, keeping unreadable lengths last", async () => {
  library = [clip(10), clip(2), clip(1)];
  vi.mocked(cachedDuration).mockImplementation(async key => key.endsWith("10.mp4") ? 2 : key.endsWith("1.mp4") ? 10 : undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const srcSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!.set!;
  vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(function (this: HTMLMediaElement, src) {
    srcSetter.call(this, src);
    queueMicrotask(() => this.dispatchEvent(new Event("error")));
  });
  render(<App />);
  await screen.findByTitle("clip-1.mp4");
  const ascending = ["clip-1.mp4", "clip-2.mp4", "clip-10.mp4"];
  const descending = [...ascending].reverse();
  expect(shown()).toEqual(ascending);
  fireEvent.click(screen.getByText(en["gallery.sortCreated"]));
  expect(shown()).toEqual(descending);
  fireEvent.click(screen.getByText(en["gallery.sortName"]));
  expect(shown()).toEqual(ascending);
  fireEvent.click(screen.getByText(en["gallery.sortName"]));
  expect(shown()).toEqual(descending);
  fireEvent.click(screen.getByText(en["gallery.sortSize"]));
  expect(shown()).toEqual(descending);
  fireEvent.click(screen.getByText(en["gallery.sortSize"]));
  expect(shown()).toEqual(ascending);
  fireEvent.click(screen.getByText(en["gallery.sortDuration"]));
  await waitFor(() => expect(shown()).toEqual(["clip-10.mp4", "clip-1.mp4", "clip-2.mp4"]));
  fireEvent.click(screen.getByText(en["gallery.sortDuration"]));
  expect(shown()).toEqual(["clip-1.mp4", "clip-10.mp4", "clip-2.mp4"]);
});

it("reads lengths beyond the current page and steps across pages in the filtered order", async () => {
  library = [...Array.from({ length: 61 }, (_, n) => clip(n)), clip(80, "Other")];
  vi.mocked(cachedDuration).mockImplementation(async key => 100 - Number(key.match(/clip-(\d+)/)![1]));
  render(<App />);
  await screen.findByTitle("clip-0.mp4");
  fireEvent.click(button("Game"));
  fireEvent.click(screen.getByText(en["gallery.sortDuration"]));
  await waitFor(() => expect(shown()[0]).toBe("clip-60.mp4"));
  expect(cachedDuration).toHaveBeenCalledTimes(61);
  fireEvent.click(screen.getByTitle("clip-1.mp4"));
  fireEvent.click(button("Next clip"));
  expect(screen.getByRole("dialog").textContent).toContain("clip-0.mp4");
  expect(screen.queryByRole("button", { name: "Next clip" })).toBeNull();
  expect(shown()).toEqual(["clip-0.mp4"]);
  fireEvent.click(button("Previous clip"));
  fireEvent.click(button("Close"));
  expect(screen.getByTitle("clip-1.mp4")).toBeTruthy();
});

it("keeps the playback session and updates neighbors when a rename moves the clip in filename order", async () => {
  library = [clip(1), clip(2)];
  render(<App />);
  await screen.findByTitle("clip-1.mp4");
  fireEvent.click(screen.getByText(en["gallery.sortName"]));
  fireEvent.click(screen.getByTitle("clip-1.mp4"));
  const player = within(screen.getByRole("dialog"));
  expect(player.queryByRole("button", { name: "Previous clip" })).toBeNull();
  fireEvent.click(button("Rename"));
  await waitFor(() => expect(player.getByRole("status").textContent).toBe("zzz.mp4 #1"));
  expect(shown()).toEqual(["clip-2.mp4", "zzz.mp4"]);
  expect(player.queryByRole("button", { name: "Next clip" })).toBeNull();
  fireEvent.click(button("Previous clip"));
  expect(player.getByRole("status").textContent).toBe("clip-2.mp4 #2");
});
