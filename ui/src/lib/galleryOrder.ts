import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gameOf } from "./format";
import { useLocale } from "./i18n";
import { convertFileSrc } from "./tauri";
import type { Clip } from "./tauri";
import { cachedDuration, tileKey } from "./thumbs";

export type SortField = "name" | "duration" | "created" | "size";
type Sort = { field: SortField; ascending: boolean };
type Durations = Map<string, number | null>;

function readMetadata(path: string, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const finish = () => {
      const seconds = video.duration;
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      video.onloadedmetadata = video.onerror = null;
      video.removeAttribute("src");
      video.load();
      resolve(Number.isFinite(seconds) ? seconds : null);
    };
    const timeout = window.setTimeout(finish, 8000);
    signal.addEventListener("abort", finish, { once: true });
    video.onloadedmetadata = video.onerror = finish;
    video.preload = "metadata";
    video.src = convertFileSrc(path);
  });
}

export function useGalleryOrder(clips: Clip[], filter: string, playing: boolean) {
  const lang = useLocale();
  const collator = useMemo(() => new Intl.Collator(lang, { numeric: true, sensitivity: "base" }), [lang]);
  const games = useMemo(() => [...new Set(clips.map(gameOf))].sort(collator.compare), [clips, collator]);
  const activeFilter = games.includes(filter) ? filter : "";
  const filtered = useMemo(() => activeFilter ? clips.filter(c => gameOf(c) === activeFilter) : clips, [clips, activeFilter]);
  const [sort, setSort] = useState<Sort>({ field: "created", ascending: false });
  const durationCache = useRef<Durations>(new Map());
  const [durations, setDurations] = useState<Durations>(() => new Map());
  const [loadingDurations, setLoadingDurations] = useState(false);

  useEffect(() => {
    const keys = new Set(clips.map(tileKey));
    for (const key of durationCache.current.keys()) {
      if (!keys.has(key)) durationCache.current.delete(key);
    }
  }, [clips]);

  useEffect(() => {
    // Apply a complete duration order at once, and keep neighbors stable during playback.
    if (sort.field !== "duration" || playing) {
      setLoadingDurations(false);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const cache = durationCache.current;
    const missing = filtered.filter(clip => !cache.has(tileKey(clip)));
    setLoadingDurations(missing.length > 0);
    let cursor = 0;
    async function worker() {
      while (!signal.aborted && cursor < missing.length) {
        const clip = missing[cursor++];
        const key = tileKey(clip);
        const saved = await cachedDuration(key);
        if (signal.aborted) return;
        const seconds = saved != null && Number.isFinite(saved) ? saved : await readMetadata(clip.path, signal);
        if (!signal.aborted) cache.set(key, seconds);
      }
    }
    void Promise.all([worker(), worker()]).then(() => {
      if (!signal.aborted) {
        setDurations(new Map(cache));
        setLoadingDurations(false);
      }
    });
    return () => controller.abort();
  }, [filtered, sort.field, playing]);

  const visible = useMemo(() => {
    const direction = sort.ascending ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let difference: number;
      if (sort.field === "name") {
        difference = collator.compare(a.name, b.name);
      } else if (sort.field === "duration") {
        const left = durations.get(tileKey(a));
        const right = durations.get(tileKey(b));
        if ((left == null) !== (right == null)) return left == null ? 1 : -1;
        difference = (left ?? 0) - (right ?? 0);
      } else {
        difference = a[sort.field] - b[sort.field];
      }
      return direction * difference || collator.compare(a.name, b.name) || a.path.localeCompare(b.path);
    });
  }, [filtered, sort, durations, collator]);

  function selectSort(field: SortField) {
    setSort(previous => ({
      field,
      ascending: previous.field === field ? !previous.ascending : field === "name" || field === "duration",
    }));
  }
  const keepRenamedDuration = useCallback((previous: Clip, updated: Clip) => {
    const cache = durationCache.current;
    const oldKey = tileKey(previous);
    const newKey = tileKey(updated);
    const seconds = cache.get(oldKey);
    if (seconds === undefined || newKey === oldKey) return;
    cache.delete(oldKey);
    cache.set(newKey, seconds);
    setDurations(published => {
      if (!published.has(oldKey)) return published;
      const next = new Map(published);
      next.delete(oldKey);
      next.set(newKey, seconds);
      return next;
    });
  }, []);
  return { activeFilter, games, visible, sort, selectSort, loadingDurations, keepRenamedDuration };
}
