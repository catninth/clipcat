import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import { invoke } from "./lib/tauri";
import { i18n } from "./lib/i18n";
import en from "../locales/en-US.json";

const { events } = vi.hoisted(() => ({ events: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock("./lib/tauri", () => ({
  invoke: vi.fn(),
  listen: vi.fn(async (name, callback) => { events.set(name, callback); return () => events.delete(name); }),
}));
vi.mock("./lib/thumbs", () => ({ pruneThumbs: vi.fn(), thumbsReady: Promise.resolve(), tileKey: vi.fn() }));
vi.mock("./components/Gallery", () => ({ Gallery: () => <div>Gallery</div> }));
vi.mock("./components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./components/Player", () => ({ Player: () => null }));
vi.mock("./components/SettingsView", () => ({ SettingsView: () => <div>Settings form</div> }));

const warning = { id: 1, deviceName: "USB microphone", reason: "missing" };
beforeEach(() => {
  i18n.lang = "en-US"; i18n.messages = en;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); events.clear(); vi.clearAllMocks(); });

it("shows a startup status warning and opens settings from the modal", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_status") return { micWarning: warning } as never;
    if (command === "list_clips") return [] as never;
    if (command === "get_settings") return {} as never;
    return null as never;
  });
  render(<App />);
  expect((await screen.findByRole("alertdialog")).textContent).toContain("USB microphone");
  fireEvent.click(screen.getByRole("button", { name: en["microphone.openSettings"] }));
  expect(screen.getByText("Settings form")).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  act(() => events.get("status")!({ payload: { micWarning: { ...warning } } }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  act(() => events.get("status")!({ payload: { micWarning: { ...warning, id: 2 } } }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  act(() => events.get("status")!({ payload: { micWarning: null } }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("does not overwrite a live disconnect with an older startup snapshot", async () => {
  let resolveSnapshot!: (value: unknown) => void;
  const snapshot = new Promise((resolve) => { resolveSnapshot = resolve; });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_status") return snapshot as never;
    if (command === "list_clips") return [] as never;
    if (command === "get_settings") return {} as never;
    return null as never;
  });
  await act(async () => { render(<App />); });
  act(() => events.get("status")!({ payload: { micWarning: warning } }));
  await act(async () => { resolveSnapshot({ micWarning: null }); });
  expect(screen.getByRole("alertdialog").textContent).toContain("USB microphone");
});
