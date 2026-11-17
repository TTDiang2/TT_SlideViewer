/**
 * LRU bitmap cache shared by both viewer panes.
 *
 * Tiles are decoded once into `ImageBitmap`s (cheap to draw, GPU resident) and
 * evicted least-recently-used when the byte budget is exceeded. `close()` is
 * always called on eviction so the GPU memory is actually released.
 */
export interface CacheEntry {
  bmp: ImageBitmap;
  bytes: number;
}

export class TileCache {
  private map = new Map<string, CacheEntry>();
  private bytes = 0;
  budget: number;
  hits = 0;
  misses = 0;

  constructor(budgetBytes = 400 * 1024 * 1024) {
    this.budget = budgetBytes;
  }

  static key(slide: string, level: number, x: number, y: number) {
    return `${slide}|${level}|${x}|${y}`;
  }

  get(key: string): ImageBitmap | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.bmp;
  }

  peek(key: string): ImageBitmap | undefined {
    return this.map.get(key)?.bmp;
  }

  async put(key: string, data: Uint8Array) {
    if (this.map.has(key)) return;
    let bmp: ImageBitmap;
    try {
      const blob = new Blob([data as unknown as BlobPart], { type: "image/jpeg" });
      bmp = await createImageBitmap(blob);
    } catch {
      return;
    }
    const bytes = bmp.width * bmp.height * 4 + (data.byteLength || 0);
    this.map.set(key, { bmp, bytes });
    this.bytes += bytes;
    this.evict();
  }

  private evict() {
    while (this.bytes > this.budget && this.map.size > 8) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (!oldest) break;
      const e = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.bytes -= e.bytes;
      e.bmp.close();
    }
  }

  setBudget(bytes: number) {
    this.budget = Math.max(64 * 1024 * 1024, bytes);
    this.evict();
  }

  clear() {
    for (const e of this.map.values()) e.bmp.close();
    this.map.clear();
    this.bytes = 0;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      bytes: this.bytes,
      count: this.map.size,
      rate: total === 0 ? 0 : this.hits / total,
      hits: this.hits,
      misses: this.misses,
    };
  }

  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }
}

export const tileCache = new TileCache();
