import { invoke } from "@tauri-apps/api/core";

export interface SlideMeta {
  id: string;
  name: string;
  case_no: string;
  site: string;
  tooth: string;
  levels: number;
  tiles: number;
  mpp: number;
  width: number;
  height: number;
  size_mb: number;
}

export interface LevelInfo {
  level: number;
  tiles: number;
  width: number;
  height: number;
  mpp: number;
}

export interface SlideInfo {
  id: string;
  name: string;
  case_no: string;
  site: string;
  tooth: string;
  mpp: number;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  levels: LevelInfo[];
  size_mb: number;
}

export interface TileBytes {
  x: number;
  y: number;
  data: Uint8Array;
}

export const listSlides = (root: string) => invoke<SlideMeta[]>("list_slides", { root });

export const warmSlides = (ids: string[]) => invoke<void>("warm_slides", { ids });

export const slideInfo = (id: string) => invoke<SlideInfo>("slide_info", { id });

export const defaultRoot = () => invoke<string | null>("default_root");

/** PNG bytes arrive as base64 — a JSON number array would stall the IPC. */
export const saveExport = (path: string, bytesB64: string) =>
  invoke<string>("save_export", { path, bytesB64 });

export const loadAnnotations = () => invoke<string>("load_annotations");

export const saveAnnotations = (json: string) => invoke<void>("save_annotations", { json });

export interface Settings {
  root: string;
  cache_mb: number;
  default_zoom: string;
  /** light / dark / system (empty = system) */
  theme: string;
}

export const loadSettings = () => invoke<Partial<Settings>>("load_settings");

export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

/** Raw batch frame: [u32 count] then [u32 x][u32 y][u32 len][bytes]... */
export async function getTiles(
  id: string,
  level: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<TileBytes[]> {
  const buf = await invoke<ArrayBuffer>("get_tiles", { id, level, x0, y0, x1, y1 });
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const out: TileBytes[] = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    const x = dv.getUint32(o, true);
    const y = dv.getUint32(o + 4, true);
    const len = dv.getUint32(o + 8, true);
    const data = new Uint8Array(buf, o + 12, len);
    out.push({ x, y, data });
    o += 12 + len;
  }
  return out;
}

/** [u32 width][u32 height][RGBA...] */
export async function slideThumb(id: string, kind: "minimap" | "preview" | "list") {
  const buf = await invoke<ArrayBuffer>("slide_thumb", { id, kind });
  if (buf.byteLength < 8) return null;
  const dv = new DataView(buf);
  const w = dv.getUint32(0, true);
  const h = dv.getUint32(4, true);
  const px = new Uint8ClampedArray(buf, 8);
  return { w, h, px };
}
