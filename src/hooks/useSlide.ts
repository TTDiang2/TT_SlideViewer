import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSlides,
  loadAnnotations,
  saveAnnotations,
  slideInfo,
  warmSlides,
  type SlideInfo,
  type SlideMeta,
} from "@/lib/ipc";
import type { Annotation } from "@/lib/types";

export function useSlides(root: string) {
  const [slides, setSlides] = useState<SlideMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!root) {
      setSlides([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await listSlides(root);
      setSlides(s);
      void warmSlides(s.map((x) => x.id));
    } catch (e) {
      setError(String(e));
      setSlides([]);
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { slides, loading, error, reload };
}

export function useSlideInfo(id: string | null) {
  const [info, setInfo] = useState<SlideInfo | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!id) {
      setInfo(null);
      return;
    }
    let alive = true;
    setLoading(true);
    slideInfo(id)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);
  return { info, loading };
}

/** Annotations for every slide live in one JSON file in the app data dir. */
export function useAnnotations(slideId: string | null) {
  const [all, setAll] = useState<Record<string, Annotation[]>>({});
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    loadAnnotations()
      .then((json) => {
        try {
          const parsed = JSON.parse(json || "{}");
          if (parsed && typeof parsed === "object") setAll(parsed);
        } catch {
          /* ignore corrupt store */
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const persist = useCallback((next: Record<string, Annotation[]>) => {
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dirty.current = false;
      void saveAnnotations(JSON.stringify(next));
    }, 300);
  }, []);

  const update = useCallback(
    (fn: (cur: Record<string, Annotation[]>) => Record<string, Annotation[]>) => {
      setAll((cur) => {
        const next = fn(cur);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const list = slideId ? all[slideId] ?? [] : [];

  const add = useCallback(
    (a: Omit<Annotation, "id">) => {
      if (!slideId) return;
      const item: Annotation = { ...a, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
      update((cur) => ({ ...cur, [slideId]: [...(cur[slideId] ?? []), item] }));
    },
    [slideId, update],
  );

  const removeLast = useCallback(() => {
    if (!slideId) return;
    update((cur) => ({ ...cur, [slideId]: (cur[slideId] ?? []).slice(0, -1) }));
  }, [slideId, update]);

  const clear = useCallback(() => {
    if (!slideId) return;
    update((cur) => ({ ...cur, [slideId]: [] }));
  }, [slideId, update]);

  return { list, add, removeLast, clear, loaded };
}
