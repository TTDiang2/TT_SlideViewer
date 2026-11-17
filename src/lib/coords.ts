/** Geometry helpers for the level pyramid. */

export const TILE_W = 303;
export const TILE_H = 253;

export interface Viewport {
  /** screen pixels per layer-0 pixel */
  scale: number;
  /** screen position of the layer-0 origin */
  tx: number;
  ty: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** Pick the pyramid level whose downsample is closest to the requested one. */
export function pickLevel(levels: number[], scale: number): number {
  const want = clamp(Math.round(-Math.log2(Math.max(scale, 1e-9))), 0, 8);
  let best = levels[0] ?? 0;
  let bestD = Infinity;
  for (const l of levels) {
    const d = Math.abs(l - want);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

export function fitScale(vw: number, vh: number, r: Rect, pad = 24) {
  const s = Math.min((vw - pad * 2) / r.w, (vh - pad * 2) / r.h);
  return Math.max(s, 0.00005);
}

export function screenToLayer0(vp: Viewport, sx: number, sy: number) {
  return { x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale };
}

export function layer0ToScreen(vp: Viewport, x: number, y: number) {
  return { x: x * vp.scale + vp.tx, y: y * vp.scale + vp.ty };
}

/** Zoom around a screen anchor, keeping the layer-0 point under it fixed. */
export function zoomAt(vp: Viewport, sx: number, sy: number, factor: number, min: number, max: number): Viewport {
  const next = clamp(vp.scale * factor, min, max);
  const k = next / vp.scale;
  return {
    scale: next,
    tx: sx - (sx - vp.tx) * k,
    ty: sy - (sy - vp.ty) * k,
  };
}

export function visibleLayer0(vp: Viewport, vw: number, vh: number): Rect {
  const a = screenToLayer0(vp, 0, 0);
  const b = screenToLayer0(vp, vw, vh);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** A tidy scale bar length (1/2/5 × 10^n px) close to `targetPx`. */
export function niceScaleBar(scale: number, mpp0: number, targetPx = 110) {
  const umPerPx = mpp0 / scale;
  const targetUm = umPerPx * targetPx;
  const pow = Math.pow(10, Math.floor(Math.log10(targetUm)));
  const base = targetUm / pow;
  const mult = base >= 5 ? 5 : base >= 2 ? 2 : 1;
  const um = mult * pow;
  return { um, px: um / umPerPx };
}

export function formatUm(um: number) {
  if (um >= 1_000_000) return `${(um / 1_000_000).toFixed(2)} m`;
  if (um >= 1000) return `${(um / 1000).toFixed(um >= 10000 ? 0 : 2)} mm`;
  if (um >= 10) return `${um.toFixed(0)} µm`;
  return `${um.toFixed(1)} µm`;
}
