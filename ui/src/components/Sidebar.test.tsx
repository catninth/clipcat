import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { Status } from "../lib/tauri";
import { i18n } from "../lib/i18n";
import en from "../../locales/en-US.json";

vi.mock("../lib/tauri", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([false, true])("shows an AFK replay pause with manual recording active=%s without changing the replay toggle", (recording) => {
  i18n.lang = "en-US";
  i18n.messages = en;
  const status: Status = {
    encoder: "obs_nvenc_h264_tex", bufferSeconds: 150, obsInstalled: true, obsRunning: true,
    replayEnabled: true, replayActive: false, afkPaused: true, bufferSince: 0,
    recording, recordingSince: recording ? Date.now() - 30000 : 0, error: null,
  };
  render(<Sidebar view="gallery" onView={vi.fn()} settings={null} status={status} onStatus={vi.fn()} update={null} />);
  expect(screen.getByText(en["status.afkPaused"])).toBeTruthy();
  expect(screen.getByText(en["status.afkPausedHint"])).toBeTruthy();
  expect(screen.queryByText(en["status.restarting"])).toBeNull();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button", { name: /Save now/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: recording ? /^Stop/ : /^Record/ }) as HTMLButtonElement).disabled).toBe(false);
});
