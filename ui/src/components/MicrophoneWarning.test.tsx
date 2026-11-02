import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MicrophoneWarning } from "./MicrophoneWarning";
import { i18n } from "../lib/i18n";
import type { MicWarning } from "../lib/tauri";
import en from "../../locales/en-US.json";
import hu from "../../locales/hu.json";

vi.mock("../lib/tauri", () => ({ invoke: vi.fn() }));

const warning: MicWarning = { id: 1, deviceName: "USB microphone", reason: "missing" };

beforeEach(() => {
  i18n.lang = "en-US";
  i18n.messages = en;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it("shows the initial warning, suppresses an acknowledged incident, and reopens a new incident", () => {
  const onSettings = vi.fn();
  const { rerender } = render(<MicrophoneWarning warning={warning} onSettings={onSettings} />);
  expect(screen.getByRole("alertdialog", { name: en["microphone.warningTitle"] }).textContent).toContain("USB microphone");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  rerender(<MicrophoneWarning warning={{ ...warning }} onSettings={onSettings} />);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  rerender(<MicrophoneWarning warning={null} onSettings={onSettings} />);
  rerender(<MicrophoneWarning warning={{ ...warning, id: 2 }} onSettings={onSettings} />);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en["microphone.openSettings"] }));
  expect(onSettings).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("closes on recovery and acknowledges Escape without suppressing future incidents", () => {
  const onSettings = vi.fn();
  const { rerender } = render(<MicrophoneWarning warning={warning} onSettings={onSettings} />);
  rerender(<MicrophoneWarning warning={null} onSettings={onSettings} />);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  rerender(<MicrophoneWarning warning={{ ...warning, id: 2 }} onSettings={onSettings} />);
  fireEvent(screen.getByRole("alertdialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  rerender(<MicrophoneWarning warning={{ ...warning, id: 3 }} onSettings={onSettings} />);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
});

it("localizes connection failure details and the unknown device label", () => {
  i18n.lang = "hu";
  i18n.messages = hu;
  render(<MicrophoneWarning warning={{ ...warning, reason: "unavailable", deviceName: "" }} onSettings={vi.fn()} />);
  const dialog = screen.getByRole("alertdialog", { name: hu["microphone.warningTitle"] });
  expect(dialog.textContent).toContain(hu["microphone.defaultName"]);
  expect(dialog.textContent).toContain("nem tudott visszacsatlakozni");
});
