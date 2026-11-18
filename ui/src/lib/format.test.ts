import { expect, it, vi } from "vitest";
import { clipSrc } from "./format";

vi.mock("./tauri", () => ({ convertFileSrc: (path: string) => path }));

const clip = { path: "C:/Clips/Game/clip.mp4", name: "clip.mp4", game: "Game", size: 1024, created: 1_700_000_000, modified: 1_700_000_000 };

it("gives a clip replaced in place a new URL, even with the same name and time", () => {
  expect(clipSrc(clip)).toBe("C:/Clips/Game/clip.mp4?v=1700000000-1024");
  expect(clipSrc({ ...clip, size: 512 })).not.toBe(clipSrc(clip));
});
