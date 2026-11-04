import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { Button } from "./ui";

const BARS = 32;
// Quietest level shown on the meter
const FLOOR_DB = -60;

// Browser labels may carry a "Default - " style prefix; the virtual default entries are never a concrete match
const VIRTUAL_IDS = ["default", "communications"];

async function openMicrophone(deviceName: string | null) {
  const constraints = (deviceId?: string): MediaStreamConstraints => ({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const first = await navigator.mediaDevices.getUserMedia(constraints());
  if (!deviceName) return first;
  let device: MediaDeviceInfo | undefined;
  try {
    // Labels are only readable after the first permission grant
    device = (await navigator.mediaDevices.enumerateDevices())
      .find((d) => d.kind === "audioinput" && !VIRTUAL_IDS.includes(d.deviceId) && d.label.includes(deviceName));
  } finally {
    first.getTracks().forEach((track) => track.stop());
  }
  if (!device) throw new DOMException(deviceName, "NotFoundError");
  return navigator.mediaDevices.getUserMedia(constraints(device.deviceId));
}

interface Props {
  /** Display name of the selected input; null follows the system default */
  deviceName: string | null;
  /** Percent applied to the signal, as in the clips */
  volume: number;
}

// Plays the microphone back through the speakers with the chosen volume, like the Discord voice test
export function MicTest({ deviceName, volume }: Props) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gain = useRef<GainNode | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    if (gain.current) gain.current.gain.value = volume / 100;
  }, [volume]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    setError(null);
    (async () => {
      try {
        stream = await openMicrophone(deviceName);
        if (!alive) return stream.getTracks().forEach((track) => track.stop());
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const node = context.createGain();
        node.gain.value = volumeRef.current / 100;
        gain.current = node;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(node);
        node.connect(analyser);
        node.connect(context.destination);
        const samples = new Float32Array(analyser.fftSize);
        const draw = () => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
          const level = Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-6) - FLOOR_DB) / -FLOOR_DB));
          const lit = Math.round(level * BARS);
          bars.current?.childNodes.forEach((bar, i) => {
            (bar as HTMLElement).style.backgroundColor = i < lit ? "var(--color-accent)" : "";
          });
          frame = requestAnimationFrame(draw);
        };
        draw();
      } catch (e) {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(t(name === "NotFoundError" ? "settings.micTest.notFound" : name === "NotAllowedError" ? "settings.micTest.denied" : "settings.micTest.failed"));
        setActive(false);
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      gain.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      bars.current?.childNodes.forEach((bar) => { (bar as HTMLElement).style.backgroundColor = ""; });
    };
  }, [active, deviceName]);

  return (
    <>
      <div ref={bars} aria-hidden className="flex h-5 items-center gap-0.75">
        {Array.from({ length: BARS }, (_, i) => <span key={i} className="h-full w-1 rounded-full bg-panel-3" />)}
      </div>
      <Button type="button" onClick={() => setActive((on) => !on)}>
        {t(active ? "settings.micTest.stop" : "settings.micTest.start")}
      </Button>
      {error && <span role="alert" className="text-xs text-danger-soft">{error}</span>}
    </>
  );
}
