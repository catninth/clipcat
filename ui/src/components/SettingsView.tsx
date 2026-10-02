import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { captureInput, isCapturing } from "../lib/capture";
import type { Captured } from "../lib/capture";
import { cx, formatDuration, prettyHotkey } from "../lib/format";
import { loadLocale, t } from "../lib/i18n";
import { invoke } from "../lib/tauri";
import type { HotkeyField, Mic, Monitor, Settings, Status, UpdateState } from "../lib/tauri";
import { Button, Card, Keycap, Range, Row, Select, Switch, TextInput } from "./ui";
import { installUpdate, isInstallable, updateProgressText } from "./updates";
import { GithubIcon } from "./icons";

// Recommended bitrate for 1080p H.264; higher than ShadowPlay's values because of the fast NVENC
// preset and disabled B-frames. The upper bound comes from the max_bitrate_mbps table in settings.rs.
const BITRATE_1080P: Record<number, number> = { 30: 20, 60: 30, 120: 45, 144: 50 };
const MAX_BITRATE: Record<number, number> = { 30: 80, 60: 100, 120: 130, 144: 150 };
const MIN_BITRATE = 5;
const MIN_BUFFER_SECONDS = 10;
const MAX_BUFFER_SECONDS = 1200;
const MIN_AFK_SECONDS = 10;
const MAX_AFK_SECONDS = 86400;
const AFK_PRESETS = [600, 1800, 3600, 7200, 10800];

const integerInRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

const AUDIO_MBPS = 0.192;
const DISK_DAILY_HOURS = 4;

function outputPixels(resolution: string, monitor?: Monitor) {
  const [w, h] = resolution === "native"
    ? monitor ? [monitor.width, monitor.height] : [screen.width * devicePixelRatio, screen.height * devicePixelRatio]
    : resolution.split("x").map(Number);
  return w * h;
}

function captureMonitor(settings: Settings, monitors: Monitor[]) {
  if (settings.captureMode !== "monitor") return undefined;
  return monitors.find((monitor) => monitor.deviceId === settings.monitorId)
    ?? monitors.find((monitor) => monitor.primary)
    ?? monitors[0];
}

function recommendedBitrate({ fps, resolution, codec }: Pick<Settings, "fps" | "resolution" | "codec">, monitor?: Monitor) {
  const pixelFactor = outputPixels(resolution, monitor) / (1920 * 1080);
  const value = BITRATE_1080P[fps] * pixelFactor * (codec === "hevc" ? 0.7 : 1);
  return Math.min(MAX_BITRATE[fps], Math.max(MIN_BITRATE, Math.round(value / 5) * 5));
}

// Saved representation: surrounding whitespace in text fields does not count as a change
const normalize = (s: Settings): Settings => ({ ...s, outputDir: s.outputDir.trim(), bufferDir: s.bufferDir.trim() });

type Message = { text: string; tone?: "ok" | "error" };

interface Props {
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onStatus: (status: Status) => void;
  update: UpdateState | null;
}

export function SettingsView({ settings, onSaved, onStatus, update }: Props) {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [customAfk, setCustomAfk] = useState(settings.afkTimeoutSeconds > 0 && !AFK_PRESETS.includes(settings.afkTimeoutSeconds));
  const [mics, setMics] = useState<Mic[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monitorsLoading, setMonitorsLoading] = useState(true);
  const [monitorsFailed, setMonitorsFailed] = useState(false);
  const [diskAvailable, setDiskAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const messageTimer = useRef(0);
  const [budget, setBudget] = useState<{ maxMb: number; seconds: number } | null>(null);
  useEffect(() => {
    if (!draft || draft.bufferStorage !== "memory"
      || !integerInRange(draft.bufferSeconds, MIN_BUFFER_SECONDS, MAX_BUFFER_SECONDS)
      || !integerInRange(draft.bitrateMbps, MIN_BITRATE, MAX_BITRATE[draft.fps])) return;
    let alive = true;
    invoke<{ maxMb: number; seconds: number }>("buffer_budget", { seconds: draft.bufferSeconds, bitrateMbps: draft.bitrateMbps })
      .then((value) => { if (alive) setBudget(value); }).catch(() => {});
    return () => { alive = false; };
  }, [draft?.bufferStorage, draft?.bufferSeconds, draft?.bitrateMbps]);

  // The running engine provides the microphone list; the disk buffer requires ffmpeg
  useEffect(() => {
    let alive = true;
    Promise.all([
      invoke<Mic[]>("list_mics").catch(() => []),
      invoke<boolean>("disk_buffer_available").catch(() => false),
    ]).then(([mics, disk]) => {
      if (!alive) return;
      setMics(mics);
      setDiskAvailable(disk);
      // Keep the saved bitrate within the supported range for the current FPS.
      const max = MAX_BITRATE[settings.fps] ?? MAX_BITRATE[60];
      setDraft({ ...settings, bitrateMbps: Math.min(max, Math.max(MIN_BITRATE, settings.bitrateMbps)) });
    });
    return () => { alive = false; };
    // Load only on open; after saving, the draft is rebuilt from the updated settings
  }, []);

  useEffect(() => () => clearTimeout(messageTimer.current), []);

  useEffect(() => {
    let alive = true;
    invoke<Monitor[]>("list_monitors").then((value) => {
      if (alive) setMonitors(value);
    }).catch(() => {
      if (alive) setMonitorsFailed(true);
    }).finally(() => {
      if (alive) setMonitorsLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const bufferValid = !!draft && integerInRange(draft.bufferSeconds, MIN_BUFFER_SECONDS, MAX_BUFFER_SECONDS);
  const bitrateValid = !!draft && integerInRange(draft.bitrateMbps, MIN_BITRATE, MAX_BITRATE[draft.fps]);
  const afkValid = !!draft && ((!customAfk && draft.afkTimeoutSeconds === 0)
    || integerInRange(draft.afkTimeoutSeconds, MIN_AFK_SECONDS, MAX_AFK_SECONDS));
  const valid = bufferValid && bitrateValid && afkValid;
  const dirty = !!draft && (JSON.stringify(normalize(draft)) !== JSON.stringify(settings) || !valid);

  // Clear the "Saved" confirmation when another change is made
  useEffect(() => {
    if (dirty && message?.tone === "ok") setMessage(null);
  }, [dirty, message]);

  if (!draft) return <SettingsFrame />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d!, [key]: value }));

  // Changing FPS, resolution, or codec selects the recommended bitrate, which remains freely editable
  const setQuality = (patch: Partial<Pick<Settings, "fps" | "resolution" | "codec">>) =>
    setDraft((d) => {
      const next = { ...d!, ...patch };
      return { ...next, bitrateMbps: recommendedBitrate(next, captureMonitor(next, monitors)) };
    });

  const pickFolder = async (field: "outputDir" | "bufferDir") => {
    const dir = await invoke<string | null>("pick_folder");
    if (dir) set(field, dir);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isCapturing() || saving || !draft || !valid) return;
    setSaving(true);
    setMessage({ text: t("settings.saving") });
    try {
      const warning = await invoke<string | null>("save_settings", { settings: normalize(draft) });
      const fresh = await invoke<Settings>("get_settings");
      await loadLocale();
      onSaved(fresh);
      setDraft(fresh);
      setMessage(warning ? { text: warning, tone: "error" } : { text: t("settings.saved"), tone: "ok" });
      clearTimeout(messageTimer.current);
      messageTimer.current = window.setTimeout(() => setMessage((m) => (m?.tone === "ok" ? null : m)), 2500);
      onStatus(await invoke<Status>("get_status"));
    } catch (err) {
      setMessage({ text: String(err), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const { bufferSeconds: buffer, bitrateMbps: bitrate, fps } = draft;
  const clipSize = Math.round((buffer * bitrate) / 8);
  // The disk buffer writes the entire video and audio stream to the SSD; estimate DISK_DAILY_HOURS hours
  // of daily gameplay against a typical 1 TB SSD's rated endurance of 600 TBW
  const gbPerHour = ((bitrate + AUDIO_MBPS) * 3600) / 8 / 1000;
  const tbPerYear = (gbPerHour * DISK_DAILY_HOURS * 365) / 1000;

  const micOptions: [string, string][] = [
    ["default", t("settings.micDevice.default")],
    ...mics.map((m): [string, string] => [
      m.id,
      m.isDefault ? t("settings.micDevice.defaultName", { name: m.name }) : m.name,
    ]),
  ];
  // Keep the saved device selectable even if it is currently disconnected
  if (!micOptions.some(([id]) => id === draft.micDevice)) micOptions.push([draft.micDevice, t("settings.micDevice.unavailable")]);

  const monitorMissing = !!draft.monitorId && !monitors.some((monitor) => monitor.deviceId === draft.monitorId);
  const monitorUnavailable = monitorMissing && !monitorsLoading && !monitorsFailed;

  const hotkeyCapture = (field: HotkeyField) => (captured: Captured) => {
    if (!captured.keyboard) return;
    const { keyboard } = captured;
    if (keyboard.key === "Backspace" || keyboard.key === "Delete") return set(field, "");
    const mods = [];
    if (keyboard.ctrlKey) mods.push("Ctrl");
    if (keyboard.altKey) mods.push("Alt");
    if (keyboard.shiftKey) mods.push("Shift");
    if (keyboard.metaKey) mods.push("Super");
    // Modifier + key, or a standalone function key
    if (!mods.length && !/^F\d+$/.test(keyboard.code)) return { text: t("hotkey.needModifier"), ms: 1500 };
    set(field, [...mods, keyboard.code].join("+"));
  };

  const pttCapture = async (captured: Captured) => {
    let vk: number, label: string;
    if (captured.keyboard) {
      const { keyboard } = captured;
      vk = keyboard.keyCode;
      label = keyboard.key.length === 1 ? keyboard.key.toUpperCase() : keyboard.key;
    } else {
      const map: Record<number, [number, string]> = { 1: [0x04, t("mouse.middle")], 3: [0x05, t("mouse.x1")], 4: [0x06, t("mouse.x2")] };
      const { button } = captured.mouse;
      if (!map[button]) return;
      [vk, label] = map[button];
    }
    if (!(await invoke<boolean>("is_ptt_key_supported", { vk }))) return { text: t("hotkey.pttUnsupported"), ms: 1800 };
    setDraft((d) => ({ ...d!, micPttVk: vk, micPttLabel: label }));
  };

  const hotkeyRows: [HotkeyField, string, string?][] = [
    ["hotkeySave", "settings.hotkeySave.label"],
    ["hotkeyRecord", "settings.hotkeyRecord.label", "settings.hotkeyRecord.hint"],
    ["hotkeyOpenFolder", "settings.hotkeyOpenFolder.label", "settings.hotkeyOpenFolder.hint"],
    ["hotkeyGallery", "settings.hotkeyGallery.label"],
  ];

  const systemSwitches: [keyof Settings, string, string?][] = [
    ["showNotification", "settings.showNotification.label", "settings.showNotification.hint"],
    ["notificationSound", "settings.notificationSound.label"],
    ["autostart", "settings.autostart.label"],
    ["keepObsRunning", "settings.keepRunning.label", "settings.keepRunning.hint"],
  ];

  return (
    <SettingsFrame>
      <form className="mx-auto flex w-full max-w-[800px] flex-col gap-7" autoComplete="off" onSubmit={submit}>
        <Card title={t("settings.capture.title")}>
          <Row label={t("settings.outputDir.label")} hints={[t("settings.outputDir.hint")]}>
            <TextInput wide readOnly aria-label={t("settings.outputDir.label")} value={draft.outputDir} />
            <Button onClick={() => pickFolder("outputDir")}>{t("settings.browse")}</Button>
          </Row>
          <Row label={t("settings.buffer.label")} hints={[
            t("settings.buffer.hint"),
            !bufferValid && { text: t("validate.buffer", { min: MIN_BUFFER_SECONDS, max: MAX_BUFFER_SECONDS }), tone: "error" },
          ]}>
            <Range aria-label={t("settings.buffer.label")} min={MIN_BUFFER_SECONDS} max={MAX_BUFFER_SECONDS} step={1}
              value={Math.min(MAX_BUFFER_SECONDS, Math.max(MIN_BUFFER_SECONDS, buffer))} onChange={(e) => set("bufferSeconds", Number(e.target.value))} />
            <NumberInput label={t("settings.buffer.input")} unit={t("settings.secondsUnit")} min={MIN_BUFFER_SECONDS} max={MAX_BUFFER_SECONDS}
              value={buffer} valid={bufferValid} onChange={(value) => set("bufferSeconds", value)} />
          </Row>
          <Row label={t("settings.storage.label")} hints={[
            t("settings.storage.hint", { size: clipSize }),
            draft.bufferStorage === "memory" && bufferValid && bitrateValid && budget && t("settings.memoryBudget", { size: budget.maxMb, duration: formatDuration(budget.seconds) }),
          ]}>
            <Select aria-label={t("settings.storage.label")} value={draft.bufferStorage}
              onValueChange={(value) => set("bufferStorage", value as Settings["bufferStorage"])}
              options={[
                { value: "memory", label: t("settings.storage.memory") },
                { value: "disk", label: t(diskAvailable ? "settings.storage.disk" : "settings.storage.diskMissing"), disabled: !diskAvailable },
              ]} />
          </Row>
          {draft.bufferStorage === "disk" && (
            <Row
              label={t("settings.bufferDir.label")}
              hints={[{
                tone: "warn",
                text: t("settings.bufferDir.hint", {
                  hour: Math.round(gbPerHour),
                  daily: DISK_DAILY_HOURS,
                  year: Math.round(tbPerYear),
                  percent: Math.max(1, Math.round((tbPerYear / 600) * 100)),
                }),
              }]}
            >
              <TextInput wide readOnly aria-label={t("settings.bufferDir.label")} value={draft.bufferDir} />
              <Button onClick={() => pickFolder("bufferDir")}>{t("settings.browse")}</Button>
            </Row>
          )}
          <Row label={t("settings.resolution.label")}>
            <Select aria-label={t("settings.resolution.label")} value={draft.resolution}
              onValueChange={(value) => setQuality({ resolution: value })}
              options={[
                { value: "native", label: t("settings.resolution.native") },
                { value: "2560x1440", label: "1440p (2560×1440)" },
                { value: "1920x1080", label: "1080p (1920×1080)" },
                { value: "1280x720", label: "720p (1280×720)" },
              ]} />
          </Row>
          <Row label={t("settings.fps.label")}>
            <Select aria-label={t("settings.fps.label")} value={fps} onValueChange={(value) => setQuality({ fps: Number(value) })}
              options={[30, 60, 120, 144].map((value) => ({ value, label: `${value} FPS` }))} />
          </Row>
          <Row
            label={t("settings.bitrate.label")}
            hints={[
              t("settings.bitrate.sizeHint", { duration: formatDuration(buffer), size: clipSize }),
              t("settings.bitrate.recommended", { value: recommendedBitrate(draft, captureMonitor(draft, monitors)), max: MAX_BITRATE[fps] }),
              !bitrateValid && { text: t("validate.bitrate", { fps, min: MIN_BITRATE, max: MAX_BITRATE[fps] }), tone: "error" },
            ]}
          >
            {/* The upper bound depends on FPS */}
            <Range aria-label={t("settings.bitrate.label")} min={MIN_BITRATE} max={MAX_BITRATE[fps]} step={1}
              value={Math.min(MAX_BITRATE[fps], Math.max(MIN_BITRATE, bitrate))} onChange={(e) => set("bitrateMbps", Number(e.target.value))} />
            <NumberInput label={t("settings.bitrate.input")} unit="Mbps" min={MIN_BITRATE} max={MAX_BITRATE[fps]}
              value={bitrate} valid={bitrateValid} onChange={(value) => set("bitrateMbps", value)} />
          </Row>
          <Row label={t("settings.codec.label")}>
            <Select aria-label={t("settings.codec.label")} value={draft.codec}
              onValueChange={(value) => setQuality({ codec: value as Settings["codec"] })}
              options={[
                { value: "h264", label: t("settings.codec.h264") },
                { value: "hevc", label: t("settings.codec.hevc") },
              ]} />
          </Row>
          <Row label={t("settings.captureMode.label")} hints={[
            t(draft.captureMode === "monitor" ? "settings.captureMode.monitorHint"
              : draft.captureDesktop ? "settings.captureMode.gameDesktopHint" : "settings.captureMode.gameHint"),
          ]}>
            <Select aria-label={t("settings.captureMode.label")} value={draft.captureMode}
              onValueChange={(value) => set("captureMode", value as Settings["captureMode"])}
              options={[
                { value: "monitor", label: t("settings.captureMode.monitor") },
                { value: "game", label: t("settings.captureMode.game") },
              ]} />
          </Row>
          {draft.captureMode === "monitor" && (
            <Row label={t("settings.monitor.label")} hints={[
              !draft.monitorId && t("settings.monitor.primaryHint"),
              monitorsLoading && t("settings.monitor.loading"),
              monitorsFailed && { text: t("settings.monitor.loadFailed"), tone: "error" },
              monitorUnavailable && { text: t("settings.monitor.unavailableHint"), tone: "warn" },
            ]}>
              <Select aria-label={t("settings.monitor.label")} value={draft.monitorId} disabled={monitorsLoading}
                onValueChange={(value) => set("monitorId", value)}
                options={[
                  { value: "", label: t("settings.monitor.primary") },
                  ...monitors.map((monitor) => ({
                    value: monitor.deviceId,
                    label: `${monitor.name} (${monitor.width} × ${monitor.height})${monitor.primary ? ` · ${t("settings.monitor.primaryLabel")}` : ""}`,
                  })),
                  ...(monitorMissing ? [{
                    value: draft.monitorId,
                    label: t(monitorUnavailable ? "settings.monitor.unavailable" : "settings.monitor.configured"),
                  }] : []),
                ]} />
            </Row>
          )}
        </Card>

        <Card title={t("settings.afkTimeout.title")}>
          <Row label={t("settings.afkTimeout.label")} hints={[
            t("settings.afkTimeout.hint"),
            !afkValid && { text: t("validate.afkTimeout", { min: MIN_AFK_SECONDS, max: MAX_AFK_SECONDS }), tone: "error" },
          ]}>
            <Select aria-label={t("settings.afkTimeout.label")} value={customAfk ? "custom" : String(draft.afkTimeoutSeconds)} onValueChange={(value) => {
              const custom = value === "custom";
              setCustomAfk(custom);
              set("afkTimeoutSeconds", custom ? draft.afkTimeoutSeconds || 600 : Number(value));
            }} options={[
              { value: "0", label: t("settings.afkTimeout.off") },
              ...AFK_PRESETS.map((seconds) => ({
                value: seconds,
                label: t(seconds < 3600 ? "settings.afkTimeout.minutes" : "settings.afkTimeout.hours", { value: seconds / (seconds < 3600 ? 60 : 3600) }),
              })),
              { value: "custom", label: t("settings.custom") },
            ]} />
            {customAfk && <NumberInput label={t("settings.afkTimeout.input")} unit={t("settings.secondsUnit")} min={MIN_AFK_SECONDS} max={MAX_AFK_SECONDS}
              value={draft.afkTimeoutSeconds} valid={afkValid} onChange={(value) => set("afkTimeoutSeconds", value)} />}
          </Row>
        </Card>

        <Card title={t("settings.audio.title")}>
          <Row label={t("settings.mic.label")}>
            <Select aria-label={t("settings.mic.label")} value={draft.micMode}
              onValueChange={(value) => set("micMode", value as Settings["micMode"])}
              options={[
                { value: "off", label: t("settings.mic.off") },
                { value: "ptt", label: t("settings.mic.ptt") },
                { value: "always", label: t("settings.mic.always") },
              ]} />
          </Row>
          {draft.micMode !== "off" && (
            <Row label={t("settings.micDevice.label")}>
              <Select aria-label={t("settings.micDevice.label")} value={draft.micDevice} onValueChange={(value) => set("micDevice", value)}
                options={micOptions.map(([value, label]) => ({ value, label }))} />
            </Row>
          )}
          {draft.micMode === "ptt" && (
            <Row label={t("settings.pttKey.label")} hints={[t("settings.pttKey.hint")]}>
              <CaptureButton label={draft.micPttLabel || "?"} modifiersOnly onCapture={pttCapture} />
            </Row>
          )}
        </Card>

        <Card title={t("settings.hotkeys.title")}>
          {hotkeyRows.map(([field, label, hint]) => (
            <Row key={field} label={t(label)} hints={[hint && t(hint)]}>
              <CaptureButton label={prettyHotkey(draft[field])} onCapture={hotkeyCapture(field)} />
            </Row>
          ))}
        </Card>

        <Card title={t("settings.system.title")}>
          <Row label={t("settings.language.label")} hints={[t("settings.language.hint")]}>
            <Select aria-label={t("settings.language.label")} value={draft.language}
              onValueChange={(value) => set("language", value as Settings["language"])}
              options={[{ value: "hu", label: "Magyar" }, { value: "en-US", label: "English US" }]} />
          </Row>
          {systemSwitches.map(([field, label, hint]) => (
            <Row key={field} label={t(label)} hints={[hint && t(hint)]}>
              <Switch checked={draft[field] as boolean} onChange={(e) => set(field, e.target.checked)} />
            </Row>
          ))}
        </Card>

        <Card title={t("settings.info.title")}>
          {update && <UpdateRow update={update} />}
          <Row label={t("settings.info.license")}>
            <Button onClick={() => invoke("open_project_link", { target: "license" }).catch((e) => setMessage({ text: String(e), tone: "error" }))}>
              {t("settings.info.license")}
            </Button>
          </Row>
          <Row label="GitHub" hints={["catninth/clipcat"]}>
            <Button aria-label={t("settings.info.repository")} title={t("settings.info.repository")} onClick={() => invoke("open_project_link", { target: "repository" }).catch((e) => setMessage({ text: String(e), tone: "error" }))}>
              <GithubIcon className="size-5" aria-hidden="true" />
            </Button>
          </Row>
        </Card>

        {/* Floating translucent save bar: visible only when something changed (or while showing a message) */}
        {(dirty || saving || message) && (
          <div
            className={cx(
              "sticky bottom-0 -mt-2 flex animate-bar-in items-center gap-3.5 rounded-xl bg-[rgba(38,38,43,.72)] py-2.5 pr-2.5 pl-4",
              "shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_0_0_1px_var(--color-line),0_12px_32px_rgba(0,0,0,.45)]",
              "backdrop-blur-[20px] backdrop-saturate-160 reduce-transparency:bg-panel-2 reduce-transparency:backdrop-blur-none",
            )}
          >
            <span className="flex-1 text-[12.5px] text-muted">{t("settings.saveNote")}</span>
            {message && (
              <span
                className={cx(
                  "text-[13px]",
                  message.tone === "ok" && "text-accent",
                  message.tone === "error" && "whitespace-pre-line text-danger-soft",
                )}
              >
                {message.text}
              </span>
            )}
            <Button type="submit" variant="primary" disabled={!dirty || !valid || saving}>{t("settings.save")}</Button>
          </div>
        )}
      </form>
    </SettingsFrame>
  );
}

function NumberInput({ label, unit, min, max, value, valid, onChange }: {
  label: string; unit: string; min: number; max: number; value: number; valid: boolean; onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap tabular">
      <TextInput type="number" className="w-[84px] text-right" style={{ minWidth: 0 }} aria-label={label} aria-invalid={!valid}
        min={min} max={max} step={1} required value={value || ""} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="text-muted">{unit}</span>
    </label>
  );
}

// Centered column with a readable width; align the heading to the same edge
function SettingsFrame({ children }: { children?: ReactNode }) {
  return (
    <section className="flex h-full animate-view-in flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-[864px] items-baseline gap-3 px-8 pt-[26px] pb-3.5">
        <h1 className="font-display text-[26px] leading-[1.15] font-bold tracking-[-.02em]">{t("settings.title")}</h1>
      </div>
      <div className="scroll-area flex-1 px-8 pt-4 pb-8">{children}</div>
    </section>
  );
}

function UpdateRow({ update }: { update: UpdateState }) {
  const installable = isInstallable(update);
  const working = update.phase === "downloading" || update.phase === "installing";
  const phaseText: Partial<Record<UpdateState["phase"], string | null>> = {
    checking: t("update.checking"),
    latest: t("update.latest"),
    available: t("update.available", { version: update.version ?? "" }),
    error: update.error,
  };
  let hint = updateProgressText(update) ?? phaseText[update.phase] ?? t("update.idle");
  if (update.phase === "available" && update.notes) hint += `\n${update.notes}`;

  return (
      <Row
        label={t("settings.update.version", { version: update.current })}
        hints={[{ text: hint, tone: update.phase === "error" ? "error" : undefined, className: "whitespace-pre-line" }]}
      >
        <Button
          variant={installable ? "primary" : "default"}
          disabled={working || update.phase === "checking"}
          // Errors arrive through the update event
          onClick={() => (installable ? installUpdate() : invoke("check_update").catch(() => {}))}
        >
          {t(installable ? "update.install" : "update.check")}
        </Button>
      </Row>
  );
}

type Flash = { text: string; ms: number };

// Show a prompt while capturing; the handler may return a short message (e.g. missing modifier)
function CaptureButton({ label, modifiersOnly, onCapture }: {
  label: string;
  modifiersOnly?: boolean;
  onCapture: (captured: Captured) => Flash | void | Promise<Flash | void>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { clearTimeout(flashTimer.current); controller.current?.abort(); }, []);

  async function start(button: HTMLButtonElement) {
    if (isCapturing()) return;
    setCapturing(true);
    const abort = new AbortController();
    controller.current = abort;
    let captured: Captured | null;
    try { captured = await captureInput(button, modifiersOnly, abort.signal); }
    catch (error) { if (!abort.signal.aborted) setFlash(String(error)); captured = null; }
    if (abort.signal.aborted) return;
    setCapturing(false);
    if (!captured) return;
    let result: Flash | void;
    try { result = await onCapture(captured); }
    catch (error) { if (!abort.signal.aborted) setFlash(String(error)); return; }
    if (abort.signal.aborted) return;
    if (!result) return;
    clearTimeout(flashTimer.current);
    setFlash(result.text);
    flashTimer.current = window.setTimeout(() => setFlash(null), result.ms);
  }

  return (
    <Keycap active={capturing} onClick={(e) => start(e.currentTarget)}>
      {capturing ? t("hotkey.capturePrompt") : flash ?? label}
    </Keycap>
  );
}
