import { useCallback, useEffect, useRef, useState } from "react";
import { Gallery } from "./components/Gallery";
import { Player } from "./components/Player";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { MicrophoneWarning } from "./components/MicrophoneWarning";
import { invoke, listen } from "./lib/tauri";
import type { Clip, Settings, Status, UpdateState, View } from "./lib/tauri";
import { pruneThumbs, thumbsReady, tileKey } from "./lib/thumbs";
import { loadLocale, useLocale } from "./lib/i18n";
import { useGalleryOrder } from "./lib/galleryOrder";

const EMPTY_LIBRARY: Clip[] = [];

export function App() {
  useLocale();
  const [view, setView] = useState<View>("gallery");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [gameFilter, setGameFilter] = useState("");
  const [playing, setPlaying] = useState<Clip | null>(null);
  const [playbackKey, setPlaybackKey] = useState(0);
  const refreshId = useRef(0);
  const order = useGalleryOrder(clips ?? EMPTY_LIBRARY, gameFilter, !!playing);
  const { keepRenamedDuration } = order;
  const playingIndex = playing ? order.visible.findIndex(c => c.path === playing.path) : -1;

  // Also delete stored thumbnails for clips that no longer exist
  useEffect(() => {
    if (clips) pruneThumbs(new Set(clips.map(tileKey)));
  }, [clips]);

  const loadClips = useCallback(async () => {
    const id = ++refreshId.current;
    const [list] = await Promise.all([invoke<Clip[]>("list_clips"), thumbsReady]);
    if (id === refreshId.current) setClips(list);
  }, []);

  useEffect(() => {
    invoke<UpdateState>("get_update_state").then(setUpdate);

    let alive = true;
    let settingsEvents = 0;
    const settingsListener = listen<Settings>("settings-changed", (e) => {
      settingsEvents++;
      if (alive) setSettings(e.payload);
    });
    void settingsListener.then(async () => {
      const before = settingsEvents;
      const initial = await invoke<Settings>("get_settings");
      if (alive && before === settingsEvents) setSettings(initial);
    });
    let statusEvents = 0;
    const statusListener = listen<Status>("status", (e) => {
      statusEvents++;
      if (alive) setStatus(e.payload);
    });
    // Register first so a startup warning cannot fall between the snapshot and subscription.
    void statusListener.then(async () => {
      const before = statusEvents;
      const initial = await invoke<Status>("get_status");
      if (alive && before === statusEvents) setStatus(initial);
    });

    const unlisten = [
      statusListener,
      settingsListener,
      listen("clip-saved", () => loadClips()),
      listen<View>("open-view", (e) => setView(e.payload)),
      listen<UpdateState>("update", (e) => setUpdate(e.payload)),
      listen("locale-changed", () => { void loadLocale(); }),
      // Stop playback when the window is hidden
      listen("main-hidden", () => setPlaying(null)),
    ];
    return () => { alive = false; unlisten.forEach((p) => p.then((off) => off())); };
  }, [loadClips]);

  // Refresh the gallery every time it opens
  useEffect(() => {
    if (view === "gallery") loadClips();
  }, [view, loadClips]);

  const closePlayer = useCallback(() => setPlaying(null), []);
  const openClip = useCallback((clip: Clip) => {
    setPlaying(clip);
    setPlaybackKey(key => key + 1);
  }, []);

  const renamed = useCallback((previous: Clip, updated: Clip) => {
    keepRenamedDuration(previous, updated);
    setPlaying(current => current?.path === previous.path ? updated : current);
    setClips(list => {
      if (!list?.some(c => c.path === previous.path)) return list;
      return list.filter(c => c.path === previous.path || c.path !== updated.path)
        .map(c => c.path === previous.path ? updated : c);
    });
    void loadClips();
  }, [keepRenamedDuration, loadClips]);

  const deleteClip = useCallback(async (clip: Clip) => {
    try {
      await invoke("delete_clip", { path: clip.path });
      setClips(list => list?.filter(c => c.path !== clip.path) ?? null);
      void loadClips();
    } catch (e) {
      alert(e);
    }
  }, [loadClips]);

  return (
    <>
      <div inert={!!playing} className="grid h-full grid-cols-[236px_1fr]">
        <Sidebar view={view} onView={setView} settings={settings} status={status} onStatus={setStatus} update={update} />
        <main className="flex flex-col overflow-hidden">
          {view === "gallery" ? (
            <Gallery order={order} playingIndex={playingIndex} onFilter={setGameFilter} hotkeySave={settings?.hotkeySave} onRefresh={loadClips} onOpen={openClip} />
          ) : (
            settings && <SettingsView settings={settings} onSaved={setSettings} onStatus={setStatus} update={update} />
          )}
        </main>
      </div>
      <Player clip={playing} playbackKey={playbackKey} onClose={closePlayer} onDelete={deleteClip} onRenamed={renamed}
        onPrevious={playingIndex > 0 ? () => openClip(order.visible[playingIndex - 1]) : undefined}
        onNext={playingIndex >= 0 && playingIndex + 1 < order.visible.length ? () => openClip(order.visible[playingIndex + 1]) : undefined} />
      <MicrophoneWarning warning={status?.micWarning ?? null} onSettings={() => { setPlaying(null); setView("settings"); }} />
    </>
  );
}
