import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { invoke } from "../lib/tauri";
import type { Mic, Monitor, Settings } from "../lib/tauri";
import { i18n, useLocale } from "../lib/i18n";
import hu from "../../locales/hu.json";
import en from "../../locales/en-US.json";

vi.mock("../lib/tauri", () => ({ invoke: vi.fn(), listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function chooseOption(combobox: HTMLElement, name: string | RegExp) {
  fireEvent.click(combobox);
  fireEvent.click(screen.getByRole("option", { name }));
}

export const settings = {
  language: "hu", outputDir: "C:/Clips", bufferDir: "C:/Buffer", bufferSeconds: 150,
  bufferStorage: "memory", resolution: "1920x1080", fps: 60, bitrateMbps: 5, codec: "h264",
  captureMode: "monitor", monitorId: "", captureDesktop: true, micMode: "off", micDevice: "default", micPttVk: 192, micPttLabel: "ö",
  hotkeySave: "Alt+F10", hotkeyRecord: "Alt+F9", hotkeyOpenFolder: "Alt+F11", hotkeyGallery: "Alt+KeyZ",
  showNotification: true, notificationSound: true, autostart: true, keepObsRunning: true,
  afkTimeoutSeconds: 0, replayEnabled: false, lastClip: null,
} as Settings;

it("preserves a valid 5 Mbps setting when another preference is saved (audit 18)", async () => {
  i18n.messages = hu;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_mics" || command === "list_monitors") return [] as never;
    if (command === "get_settings") return settings as never;
    if (command === "get_locale") return { lang: "hu", messages: hu } as never;
    return false as never;
  });
  render(<SettingsView settings={settings} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  const bitrate = await screen.findByRole("spinbutton", { name: hu["settings.bitrate.input"] }) as HTMLInputElement;
  expect(bitrate.value).toBe("5");
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: hu["settings.save"] }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_settings", {
    settings: expect.objectContaining({ bitrateMbps: 5 }),
  }));
});

it("saves English US and updates all visible settings without restarting", async () => {
  i18n.lang = "hu"; i18n.messages = hu;
  let saved = settings;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_mics" || command === "list_monitors") return [] as never;
    if (command === "save_settings") { saved = (args as { settings: Settings }).settings; return "" as never; }
    if (command === "get_settings") return saved as never;
    if (command === "get_locale") return { lang: saved.language, messages: saved.language === "hu" ? hu : en } as never;
    return false as never;
  });
  function Page() { useLocale(); return <SettingsView settings={settings} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />; }
  render(<Page />);
  const language = await screen.findByRole("combobox", { name: hu["settings.language.label"] });
  fireEvent.click(language);
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["Magyar", "English US"]);
  expect(screen.getByRole("option", { name: "Magyar", selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "English US" }));
  fireEvent.click(screen.getByRole("button", { name: hu["settings.save"] }));
  await screen.findByRole("heading", { name: "Settings" });
  expect(saved.language).toBe("en-US");
  expect(document.documentElement.lang).toBe("en-US");
});

it("places update, license and accessible GitHub button in the bottom Info section", async () => {
  i18n.lang = "en-US"; i18n.messages = en;
  vi.mocked(invoke).mockImplementation(async command => command === "list_mics" || command === "list_monitors" ? [] as never : false as never);
  render(<SettingsView settings={{ ...settings, language: "en-US" }} onSaved={vi.fn()} onStatus={vi.fn()}
    update={{ current: "0.4.1", phase: "latest", version: null, notes: null, progress: null, error: null }} />);
  const github = await screen.findByRole("button", { name: en["settings.info.repository"] });
  fireEvent.click(github);
  fireEvent.click(screen.getByRole("button", { name: en["settings.info.license"] }));
  expect(invoke).toHaveBeenCalledWith("open_project_link", { target: "repository" });
  expect(invoke).toHaveBeenCalledWith("open_project_link", { target: "license" });
  expect(screen.getByText("ClipCat v0.4.1")).toBeTruthy();
  expect(screen.getAllByRole("heading").at(-1)?.textContent).toBe("Info");
});

const monitors: Monitor[] = [
  { deviceId: "display-primary", name: "Main display", width: 3840, height: 2160, primary: true },
  { deviceId: "display-secondary", name: "Side display", width: 2560, height: 1440, primary: false },
];

it.each([
  { language: "hu" as const, messages: hu, defaultName: "USB microphone (alapértelmezett)" },
  { language: "en-US" as const, messages: en, defaultName: "USB microphone (default)" },
])("labels the system-default microphone in $language and saves its device ID", async ({ language, messages, defaultName }) => {
  i18n.lang = language;
  i18n.messages = messages;
  const initial: Settings = { ...settings, language, micMode: "always", micDevice: "headset-mic" };
  let saved = initial;
  const mics: Mic[] = [
    { id: "headset-mic", name: "Headset microphone", isDefault: false },
    { id: "usb-mic", name: "USB microphone", isDefault: true },
  ];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_mics") return mics as never;
    if (command === "list_monitors") return [] as never;
    if (command === "save_settings") { saved = (args as { settings: Settings }).settings; return "" as never; }
    if (command === "get_settings") return saved as never;
    if (command === "get_locale") return { lang: language, messages } as never;
    return false as never;
  });
  const onSaved = vi.fn();
  render(<SettingsView settings={initial} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const microphone = await screen.findByRole("combobox", { name: messages["settings.micDevice.label"] });
  expect(microphone.textContent).toBe("Headset microphone");
  fireEvent.click(microphone);
  expect(screen.getByRole("option", { name: "Headset microphone", selected: true })).toBeTruthy();
  expect(screen.getByRole("option", { name: messages["settings.micDevice.default"], selected: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: defaultName, selected: false }));
  expect(microphone.textContent).toBe(defaultName);
  fireEvent.click(screen.getByRole("button", { name: messages["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ micDevice: "usb-mic" })));

  chooseOption(microphone, messages["settings.micDevice.default"]);
  fireEvent.click(screen.getByRole("button", { name: messages["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ micDevice: "default" })));
});

function mockCaptureSettings(initial: Settings, listMonitors: () => Promise<Monitor[]> = async () => monitors) {
  i18n.lang = "en-US";
  i18n.messages = en;
  let saved = initial;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_mics") return [] as never;
    if (command === "list_monitors") return await listMonitors() as never;
    if (command === "save_settings") { saved = (args as { settings: Settings }).settings; return "" as never; }
    if (command === "get_settings") return saved as never;
    if (command === "get_locale") return { lang: "en-US", messages: en } as never;
    return false as never;
  });
  return () => saved;
}

it("offers exactly two capture modes and saves the selected monitor across reopening Settings", async () => {
  const initial: Settings = { ...settings, language: "en-US", captureMode: "game", captureDesktop: false };
  const saved = mockCaptureSettings(initial);
  const onSaved = vi.fn();
  render(<SettingsView settings={initial} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const mode = await screen.findByRole("combobox", { name: en["settings.captureMode.label"] });
  fireEvent.click(mode);
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual([
    en["settings.captureMode.monitor"], en["settings.captureMode.game"],
  ]);
  expect(screen.getByRole("option", { name: en["settings.captureMode.game"], selected: true })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: en["settings.monitor.label"] })).toBeNull();
  expect(screen.getByText(en["settings.captureMode.gameHint"])).toBeTruthy();

  fireEvent.click(screen.getByRole("option", { name: en["settings.captureMode.monitor"] }));
  const monitor = screen.getByRole("combobox", { name: en["settings.monitor.label"] });
  expect(monitor.textContent).toBe(en["settings.monitor.primary"]);
  expect(screen.getByText(en["settings.captureMode.monitorHint"])).toBeTruthy();
  fireEvent.click(monitor);
  expect(screen.getByRole("option", { name: /Main display/ }).textContent).toContain("3840 × 2160");
  expect(screen.getByRole("option", { name: en["settings.monitor.primary"], selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: /Side display/ }));
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
    captureMode: "monitor", monitorId: "display-secondary", captureDesktop: false,
  })));

  cleanup();
  render(<SettingsView settings={saved()} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  const reopened = await screen.findByRole("combobox", { name: en["settings.monitor.label"] });
  expect(reopened.textContent).toBe("Side display (2560 × 1440)");
  fireEvent.click(reopened);
  expect(screen.getByRole("option", { name: /Side display/, selected: true })).toBeTruthy();
});

it.each([true, false])("preserves the legacy desktop fallback (%s) and monitor selection when saving game mode", async (captureDesktop) => {
  const initial: Settings = { ...settings, language: "en-US", monitorId: "display-secondary", captureDesktop };
  mockCaptureSettings(initial);
  const onSaved = vi.fn();
  render(<SettingsView settings={initial} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const mode = await screen.findByRole("combobox", { name: en["settings.captureMode.label"] });
  chooseOption(mode, en["settings.captureMode.game"]);
  expect(screen.queryByRole("combobox", { name: en["settings.monitor.label"] })).toBeNull();
  expect(screen.getByText(en[captureDesktop ? "settings.captureMode.gameDesktopHint" : "settings.captureMode.gameHint"])).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
    captureMode: "game", monitorId: "display-secondary", captureDesktop,
  })));
});

it("keeps an unavailable monitor selected, warns about fallback, and allows choosing automatic primary", async () => {
  const initial: Settings = { ...settings, language: "en-US", monitorId: "disconnected-display" };
  mockCaptureSettings(initial);
  const onSaved = vi.fn();
  render(<SettingsView settings={initial} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  await screen.findByText(en["settings.monitor.unavailableHint"]);
  const monitor = screen.getByRole("combobox", { name: en["settings.monitor.label"] }) as HTMLButtonElement;
  expect(monitor.textContent).toBe(en["settings.monitor.unavailable"]);
  expect(monitor.value).toBe("disconnected-display");
  expect(screen.queryByRole("button", { name: en["settings.save"] })).toBeNull();
  fireEvent.click(monitor);
  expect(screen.getByRole("option", { name: en["settings.monitor.unavailable"], selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: en["settings.monitor.primary"] }));
  expect(screen.queryByText(en["settings.monitor.unavailableHint"])).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ captureMode: "monitor", monitorId: "" })));
});

it("keeps the configured monitor while detection is pending and does not report it as disconnected", async () => {
  let resolveMonitors!: (value: Monitor[]) => void;
  mockCaptureSettings(settings, () => new Promise((resolve) => { resolveMonitors = resolve; }));
  render(<SettingsView settings={{ ...settings, monitorId: "display-secondary" }} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  await screen.findByText(en["settings.monitor.loading"]);
  const monitor = screen.getByRole("combobox", { name: en["settings.monitor.label"] }) as HTMLButtonElement;
  expect(monitor.disabled).toBe(true);
  expect(monitor.textContent).toBe(en["settings.monitor.configured"]);
  expect(monitor.value).toBe("display-secondary");
  expect(screen.queryByText(en["settings.monitor.unavailableHint"])).toBeNull();
  await act(async () => resolveMonitors(monitors));
  expect(monitor.disabled).toBe(false);
  expect(monitor.textContent).toBe("Side display (2560 × 1440)");
  expect(screen.queryByText(en["settings.monitor.loading"])).toBeNull();
});

it("shows monitor detection failure without discarding the saved monitor", async () => {
  const initial: Settings = { ...settings, language: "en-US", monitorId: "display-secondary" };
  mockCaptureSettings(initial, async () => { throw new Error("Enumeration failed"); });
  render(<SettingsView settings={initial} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  await screen.findByText(en["settings.monitor.loadFailed"]);
  const monitor = screen.getByRole("combobox", { name: en["settings.monitor.label"] }) as HTMLButtonElement;
  expect(monitor.textContent).toBe(en["settings.monitor.configured"]);
  expect(monitor.value).toBe("display-secondary");
  expect(monitor.disabled).toBe(false);
  expect(screen.queryByText(en["settings.monitor.unavailableHint"])).toBeNull();
});

it("bases native-resolution bitrate advice on the monitor being captured", async () => {
  const initial: Settings = { ...settings, language: "en-US", monitorId: "display-secondary" };
  mockCaptureSettings(initial);
  render(<SettingsView settings={initial} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  const resolution = await screen.findByRole("combobox", { name: en["settings.resolution.label"] });
  chooseOption(resolution, en["settings.resolution.native"]);
  expect((screen.getByRole("spinbutton", { name: en["settings.bitrate.input"] }) as HTMLInputElement).value).toBe("55");
});

it("saves exact custom replay length and bitrate, keeps sliders in sync, and restores them after reopening", async () => {
  const saved = mockCaptureSettings(settings);
  const onSaved = vi.fn();
  render(<SettingsView settings={settings} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const duration = await screen.findByRole("spinbutton", { name: en["settings.buffer.input"] });
  const bitrate = screen.getByRole("spinbutton", { name: en["settings.bitrate.input"] });
  fireEvent.change(duration, { target: { value: "137" } });
  fireEvent.change(bitrate, { target: { value: "27" } });
  expect((screen.getByRole("slider", { name: en["settings.buffer.label"] }) as HTMLInputElement).value).toBe("137");
  expect((screen.getByRole("slider", { name: en["settings.bitrate.label"] }) as HTMLInputElement).value).toBe("27");
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ bufferSeconds: 137, bitrateMbps: 27, afkTimeoutSeconds: 0 })));

  cleanup();
  render(<SettingsView settings={saved()} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  expect((await screen.findByRole("spinbutton", { name: en["settings.buffer.input"] }) as HTMLInputElement).value).toBe("137");
  expect((screen.getByRole("spinbutton", { name: en["settings.bitrate.input"] }) as HTMLInputElement).value).toBe("27");
});

it("starts with AFK replay pausing disabled and offers only the requested preset timeouts", async () => {
  mockCaptureSettings(settings);
  const onSaved = vi.fn();
  render(<SettingsView settings={settings} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const afk = await screen.findByRole("combobox", { name: en["settings.afkTimeout.label"] });
  expect(afk.textContent).toBe(en["settings.afkTimeout.off"]);
  fireEvent.click(afk);
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual([
    en["settings.afkTimeout.off"], "10 min", "30 min", "1 h", "2 h", "3 h", en["settings.custom"],
  ]);
  expect(screen.getByRole("option", { name: en["settings.afkTimeout.off"], selected: true })).toBeTruthy();
  expect(screen.queryByRole("spinbutton", { name: en["settings.afkTimeout.input"] })).toBeNull();
  expect(screen.queryByRole("button", { name: en["settings.save"] })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "10 min" }));
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ afkTimeoutSeconds: 600 })));
});

it.each([[1, 3600], [2, 7200], [3, 10800]])("saves the %i-hour AFK preset as %i seconds", async (hours, seconds) => {
  mockCaptureSettings(settings);
  const onSaved = vi.fn();
  render(<SettingsView settings={settings} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const afk = await screen.findByRole("combobox", { name: en["settings.afkTimeout.label"] });
  chooseOption(afk, `${hours} h`);
  expect(screen.queryByRole("spinbutton", { name: en["settings.afkTimeout.input"] })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ afkTimeoutSeconds: seconds })));
});

it.each([60, 300])("shows a previously saved %i-second AFK timeout as custom without changing its value", async (seconds) => {
  const initial: Settings = { ...settings, afkTimeoutSeconds: seconds };
  mockCaptureSettings(initial);
  const onSaved = vi.fn();
  render(<SettingsView settings={initial} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const afk = await screen.findByRole("combobox", { name: en["settings.afkTimeout.label"] });
  expect(afk.textContent).toBe(en["settings.custom"]);
  expect((screen.getByRole("spinbutton", { name: en["settings.afkTimeout.input"] }) as HTMLInputElement).value).toBe(String(seconds));
  expect(screen.queryByRole("button", { name: en["settings.save"] })).toBeNull();
  fireEvent.change(screen.getByRole("spinbutton", { name: en["settings.buffer.input"] }), { target: { value: "137" } });
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ afkTimeoutSeconds: seconds, bufferSeconds: 137 })));
});

it("labels minute and hour presets in Hungarian", async () => {
  mockCaptureSettings(settings);
  i18n.lang = "hu";
  i18n.messages = hu;
  render(<SettingsView settings={settings} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  fireEvent.click(await screen.findByRole("combobox", { name: hu["settings.afkTimeout.label"] }));
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual([
    hu["settings.afkTimeout.off"], "10 perc", "30 perc", "1 óra", "2 óra", "3 óra", hu["settings.custom"],
  ]);
});

it("saves and restores a custom AFK timeout and can disable it again", async () => {
  const saved = mockCaptureSettings(settings);
  const onSaved = vi.fn();
  render(<SettingsView settings={settings} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const afk = await screen.findByRole("combobox", { name: en["settings.afkTimeout.label"] });
  chooseOption(afk, en["settings.custom"]);
  expect((screen.getByRole("spinbutton", { name: en["settings.afkTimeout.input"] }) as HTMLInputElement).value).toBe("600");
  fireEvent.change(screen.getByRole("spinbutton", { name: en["settings.afkTimeout.input"] }), { target: { value: "137" } });
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ afkTimeoutSeconds: 137 })));

  cleanup();
  onSaved.mockClear();
  render(<SettingsView settings={saved()} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const reopened = await screen.findByRole("combobox", { name: en["settings.afkTimeout.label"] });
  expect(reopened.textContent).toBe(en["settings.custom"]);
  expect((screen.getByRole("spinbutton", { name: en["settings.afkTimeout.input"] }) as HTMLInputElement).value).toBe("137");
  chooseOption(reopened, en["settings.afkTimeout.off"]);
  expect(screen.queryByRole("spinbutton", { name: en["settings.afkTimeout.input"] })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ afkTimeoutSeconds: 0 })));
});

it.each([
  ["settings.buffer.input", ""], ["settings.buffer.input", "9"], ["settings.buffer.input", "1201"], ["settings.buffer.input", "15.5"],
  ["settings.bitrate.input", ""], ["settings.bitrate.input", "4"], ["settings.bitrate.input", "101"], ["settings.bitrate.input", "27.5"],
  ["settings.afkTimeout.input", ""], ["settings.afkTimeout.input", "0"], ["settings.afkTimeout.input", "9"], ["settings.afkTimeout.input", "86401"], ["settings.afkTimeout.input", "60.5"],
] as const)("blocks invalid custom %s value '%s' without sending it to the backend", async (label, value) => {
  mockCaptureSettings(settings);
  render(<SettingsView settings={settings} onSaved={vi.fn()} onStatus={vi.fn()} update={null} />);
  const afk = await screen.findByRole("combobox", { name: en["settings.afkTimeout.label"] });
  if (label === "settings.afkTimeout.input") chooseOption(afk, en["settings.custom"]);
  const input = screen.getByRole("spinbutton", { name: en[label] }) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect((screen.getByRole("button", { name: en["settings.save"] }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(input.closest("form")!);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "save_settings")).toBe(false);
});

it("updates custom bitrate bounds when FPS changes and accepts a valid boundary value", async () => {
  const initial: Settings = { ...settings, fps: 144, bitrateMbps: 150 };
  mockCaptureSettings(initial);
  const onSaved = vi.fn();
  render(<SettingsView settings={initial} onSaved={onSaved} onStatus={vi.fn()} update={null} />);
  const bitrate = await screen.findByRole("spinbutton", { name: en["settings.bitrate.input"] }) as HTMLInputElement;
  expect(bitrate.value).toBe("150");
  expect(bitrate.max).toBe("150");
  chooseOption(screen.getByRole("combobox", { name: en["settings.fps.label"] }), "30 FPS");
  expect(bitrate.max).toBe("80");
  expect(bitrate.value).toBe("20");
  fireEvent.change(bitrate, { target: { value: "81" } });
  expect((screen.getByRole("button", { name: en["settings.save"] }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(bitrate, { target: { value: "80" } });
  fireEvent.click(screen.getByRole("button", { name: en["settings.save"] }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ fps: 30, bitrateMbps: 80 })));
});
