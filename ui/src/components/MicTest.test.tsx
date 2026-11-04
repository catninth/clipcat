import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MicTest } from "./MicTest";
import { i18n } from "../lib/i18n";
import en from "../../locales/en-US.json";

const getUserMedia = vi.fn<MediaDevices["getUserMedia"]>();
const enumerateDevices = vi.fn<MediaDevices["enumerateDevices"]>();
const createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
const closeContext = vi.fn<() => Promise<void>>();

function microphone() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

beforeEach(() => {
  i18n.lang = "en-US";
  i18n.messages = en;
  getUserMedia.mockReset();
  enumerateDevices.mockReset();
  createMediaStreamSource.mockClear();
  closeContext.mockReset().mockResolvedValue();
  vi.stubGlobal("navigator", Object.create(navigator, {
    mediaDevices: { value: { getUserMedia, enumerateDevices } },
  }));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("AudioContext", class {
    destination = {};
    createMediaStreamSource = createMediaStreamSource;
    createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData: vi.fn() }; }
    close = closeContext;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["rejects", "finds no device"])("releases the initial microphone when enumeration %s", async (outcome) => {
  const initial = microphone();
  getUserMedia.mockResolvedValue(initial.stream);
  if (outcome === "rejects") enumerateDevices.mockRejectedValue(new DOMException("Enumeration failed", "AbortError"));
  else enumerateDevices.mockResolvedValue([]);
  const view = render(<MicTest deviceName="USB microphone" volume={100} />);

  fireEvent.click(screen.getByRole("button", { name: en["settings.micTest.start"] }));

  expect((await screen.findByRole("alert")).textContent).toBe(en[outcome === "rejects" ? "settings.micTest.failed" : "settings.micTest.notFound"]);
  expect(screen.getByRole("button", { name: en["settings.micTest.start"] })).toBeTruthy();
  expect(initial.stop).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
  view.unmount();
  expect(initial.stop).toHaveBeenCalledOnce();
});

it("releases the initial microphone when enumeration fails after unmount", async () => {
  const initial = microphone();
  getUserMedia.mockResolvedValue(initial.stream);
  let rejectEnumeration!: (reason: unknown) => void;
  enumerateDevices.mockReturnValue(new Promise((_, reject) => { rejectEnumeration = reject; }));
  const view = render(<MicTest deviceName="USB microphone" volume={100} />);
  fireEvent.click(screen.getByRole("button", { name: en["settings.micTest.start"] }));
  await waitFor(() => expect(enumerateDevices).toHaveBeenCalledOnce());

  view.unmount();
  await act(async () => { rejectEnumeration(new DOMException("Enumeration failed", "AbortError")); });

  expect(initial.stop).toHaveBeenCalledOnce();
  expect(createMediaStreamSource).not.toHaveBeenCalled();
});

it.each(["USB microphone", null])("keeps the playback stream open until stopped for %s", async (deviceName) => {
  const initial = microphone();
  const selected = microphone();
  getUserMedia.mockResolvedValueOnce(initial.stream).mockImplementationOnce(async () => {
    expect(initial.stop).toHaveBeenCalledOnce();
    return selected.stream;
  });
  enumerateDevices.mockResolvedValue([
    { kind: "audioinput", deviceId: "usb-mic", label: "USB microphone" } as MediaDeviceInfo,
  ]);
  render(<MicTest deviceName={deviceName} volume={100} />);
  fireEvent.click(screen.getByRole("button", { name: en["settings.micTest.start"] }));
  const playback = deviceName ? selected : initial;

  await waitFor(() => expect(createMediaStreamSource).toHaveBeenCalledWith(playback.stream));
  expect(playback.stop).not.toHaveBeenCalled();
  if (deviceName) {
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: {
      deviceId: { exact: "usb-mic" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
  } else {
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(enumerateDevices).not.toHaveBeenCalled();
  }

  fireEvent.click(screen.getByRole("button", { name: en["settings.micTest.stop"] }));

  expect(playback.stop).toHaveBeenCalledOnce();
  expect(closeContext).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
});
