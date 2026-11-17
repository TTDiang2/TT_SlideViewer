//! MIRAX (`Pannoramic`) slide index parser.
//!
//! `Index.dat` is a 325-byte header followed by flat 16-byte little-endian
//! records, one per JPEG tile.  Two cyclic field layouts are used, and the
//! layout is selected per *data file*:
//!
//!   layout A: [key][offset][length][fileno]
//!   layout B: [length][fileno][key][offset]
//!
//! The stored `length` is unreliable (it describes the previous tile), so
//! lengths are recomputed from neighbouring offsets and trimmed at EOI.
//!
//! A data file's zoom level is derived from the 2-adic valuation of its tile
//! keys: level-`k` keys are multiples of `2^k`, and about half of them are not
//! multiples of `2^(k+1)`, so the histogram mode is the level.  This is more
//! robust than a fixed fileno table, which differs from slide to slide.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub const TILE_W: u32 = 303;
pub const TILE_H: u32 = 253;
pub const GRID_W: u32 = 296;
pub const GRID_H: u32 = 792;
const HEADER_LEN: usize = 325;
const MAX_KEY: u32 = GRID_W * GRID_H * 256;
const PROBE: u64 = 4096;

#[derive(Clone, Copy, Debug)]
pub struct TileRef {
    pub x: u32,
    pub y: u32,
    pub file: u32,
    pub offset: u64,
    pub len: u32,
}

#[derive(Default)]
pub struct Level {
    pub tiles: Vec<TileRef>,
    lookup: HashMap<u64, u32>,
    /// level pixel dimensions (before scaling back to layer 0)
    pub w: u64,
    pub h: u64,
}

impl Level {
    pub fn get(&self, x: u32, y: u32) -> Option<&TileRef> {
        self.lookup
            .get(&((y as u64) << 32 | x as u64))
            .map(|i| &self.tiles[*i as usize])
    }
}

pub struct SlideIndex {
    /// index 0 == layer 0 (highest resolution). Missing levels are empty.
    pub levels: Vec<Level>,
    pub mpp0: f64,
    /// layer-0 canvas size derived from the level-0 tile extent
    pub w0: u64,
    pub h0: u64,
    /// layer-0 bounding box of the tissue (x, y, w, h)
    pub bbox0: [u64; 4],
}

fn v2(mut n: u32) -> u32 {
    let mut v = 0;
    while n > 0 && n % 2 == 0 {
        n /= 2;
        v += 1;
    }
    v
}

fn soi(b: &[u8], i: usize) -> bool {
    i + 3 <= b.len() && b[i] == 0xFF && b[i + 1] == 0xD8 && b[i + 2] == 0xFF
}

/// A handful of 4 KiB windows spread over a data file, enough to validate
/// offsets without reading hundreds of megabytes into memory.
struct Probe {
    size: u64,
    chunks: Vec<(u64, Vec<u8>)>,
}

impl Probe {
    fn read(path: &Path, offsets: &[u64]) -> Option<Probe> {
        let size = fs::metadata(path).ok()?.len();
        let mut f = File::open(path).ok()?;
        let mut chunks = Vec::new();
        for off in offsets {
            let base = off.saturating_sub(2048);
            let take = PROBE.min(size.saturating_sub(base));
            if take < 4 {
                continue;
            }
            let mut b = vec![0u8; take as usize];
            if f.seek(SeekFrom::Start(base)).is_ok() && f.read_exact(&mut b).is_ok() {
                chunks.push((base, b));
            }
        }
        Some(Probe { size, chunks })
    }

    fn magic_at(&self, off: u64) -> Option<bool> {
        for (base, bytes) in &self.chunks {
            if off >= *base && off + 3 <= *base + bytes.len() as u64 {
                return Some(soi(bytes, (off - base) as usize));
            }
        }
        None
    }

    fn nearest_soi_delta(&self, off: u64) -> Option<i64> {
        for (base, bytes) in &self.chunks {
            if off >= *base && off < *base + bytes.len() as u64 {
                let mut best: Option<i64> = None;
                for i in 0..bytes.len().saturating_sub(2) {
                    if soi(bytes, i) {
                        let d = (base + i as u64) as i64 - off as i64;
                        if best.map_or(true, |b| d.abs() < b.abs()) {
                            best = Some(d);
                        }
                    }
                }
                return best;
            }
        }
        None
    }
}

pub fn mpp_from_ini(dir: &Path) -> f64 {
    let Ok(ini) = fs::read_to_string(dir.join("Slidedat.ini")) else {
        return 0.273809523809524;
    };
    let mut in_section = false;
    for line in ini.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line.eq_ignore_ascii_case("[LAYER_0_LEVEL_0_SECTION]");
            continue;
        }
        if in_section {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim().eq_ignore_ascii_case("MICROMETER_PER_PIXEL_X") {
                    if let Ok(v) = v.trim().parse::<f64>() {
                        if v > 0.0 {
                            return v;
                        }
                    }
                }
            }
        }
    }
    0.273809523809524
}

pub fn parse(dir: &Path) -> Result<SlideIndex, String> {
    let buf = fs::read(dir.join("Index.dat")).map_err(|e| format!("读取 Index.dat 失败: {e}"))?;
    if buf.len() < HEADER_LEN + 16 {
        return Err("Index.dat 尺寸异常".into());
    }

    let mut files: Vec<(u32, String)> = Vec::new();
    for ent in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if let Some(num) = lower
            .strip_prefix("data")
            .and_then(|s| s.strip_suffix(".dat"))
        {
            if let Ok(n) = num.parse::<u32>() {
                files.push((n, name));
            }
        }
    }
    files.sort_by_key(|(n, _)| *n);
    let known: Vec<u32> = files.iter().map(|(n, _)| *n).collect();

    let mut recs: Vec<[u32; 4]> = Vec::with_capacity(buf.len() / 16);
    let mut o = HEADER_LEN;
    while o + 16 <= buf.len() {
        recs.push([
            u32::from_le_bytes(buf[o..o + 4].try_into().unwrap()),
            u32::from_le_bytes(buf[o + 4..o + 8].try_into().unwrap()),
            u32::from_le_bytes(buf[o + 8..o + 12].try_into().unwrap()),
            u32::from_le_bytes(buf[o + 12..o + 16].try_into().unwrap()),
        ]);
        o += 16;
    }

    /// (level, x, y, file, offset, len)
    type Tile = (u32, u32, u32, u32, u64, u32);
    let mut all: Vec<Tile> = Vec::new();

    for no in &known {
        // layout: fileno fields are tiny, offsets never are
        let (mut a, mut b) = (0u32, 0u32);
        for r in &recs {
            if r[3] == *no {
                a += 1;
            }
            if r[1] == *no {
                b += 1;
            }
        }
        if a == 0 && b == 0 {
            continue;
        }
        let layout_a = a >= b;
        let mut list: Vec<(u32, u64)> = Vec::new();
        for r in &recs {
            let (key, off) = if layout_a {
                (r[0], r[1] as u64)
            } else {
                (r[2], r[3] as u64)
            };
            let fileno = if layout_a { r[3] } else { r[1] };
            if fileno != *no || key >= MAX_KEY || off < 256 {
                continue;
            }
            list.push((key, off));
        }
        if list.len() < 3 {
            continue;
        }

        let name = files.iter().find(|(n, _)| n == no).map(|(_, s)| s.clone()).unwrap();
        let path = dir.join(&name);
        let step = (list.len() / 20).max(1);
        let mut sample: Vec<u64> = Vec::new();
        let mut i = 0;
        while i < list.len() && sample.len() < 20 {
            sample.push(list[i].1);
            i += step;
        }
        let Some(probe) = Probe::read(&path, &sample) else {
            continue;
        };

        let hits = sample.iter().filter(|o| probe.magic_at(**o) == Some(true)).count();
        let mut delta = 0i64;
        if hits * 2 < sample.len() {
            let mut votes: HashMap<i64, u32> = HashMap::new();
            for off in &sample {
                if let Some(d) = probe.nearest_soi_delta(*off) {
                    *votes.entry(d).or_insert(0) += 1;
                }
            }
            if let Some((d, n)) = votes.into_iter().max_by_key(|(_, v)| *v) {
                // A real shift (e.g. a truncated file header) is consistent and
                // small; random text/XML data files produce scattered votes.
                if n * 2 >= sample.len() as u32 && d.abs() <= 8192 {
                    delta = d;
                }
            }
        }
        // Reject data files that are not actually tile stores (preview images,
        // scan-log XML, ...).  Only a majority of sampled offsets needs to
        // carry a JPEG SOI after the shift is applied.
        let good = sample
            .iter()
            .filter(|o| {
                let t = **o as i64 + delta;
                t >= 0 && probe.magic_at(t as u64) == Some(true)
            })
            .count();
        if good * 2 < sample.len() {
            continue;
        }

        let mut hist: HashMap<u32, u32> = HashMap::new();
        for (key, _) in &list {
            if *key > 0 {
                *hist.entry(v2(*key)).or_insert(0) += 1;
            }
        }
        // Keys of level-k tiles are multiples of 2^k; roughly half of them are
        // *not* multiples of 2^(k+1).  When the histogram is flat between k and
        // k+1 (small files), the true level is the smallest v whose count is at
        // least half of the peak — taking the peak itself can pick k+1.
        let peak = hist.values().copied().max().unwrap_or(0);
        let level = hist
            .iter()
            .filter(|(_, c)| **c * 2 >= peak)
            .map(|(l, _)| *l)
            .min()
            .unwrap_or(0);
        if level > 8 {
            continue;
        }

        let mut fixed: Vec<(u32, u64)> = Vec::new();
        for (key, off) in list {
            let t = off as i64 + delta;
            if t < 256 || t as u64 >= probe.size {
                continue;
            }
            fixed.push((key, t as u64));
        }
        fixed.sort_by_key(|(_, o)| *o);

        for (i, (key, off)) in fixed.iter().enumerate() {
            let next = fixed.get(i + 1).map(|(_, o)| *o).unwrap_or(probe.size);
            let len = next.saturating_sub(*off).min(4_000_000) as u32;
            if len < 64 {
                continue;
            }
            let t = *key >> level;
            let x = t % GRID_W;
            let y = t / GRID_W;
            if x >= GRID_W || y >= GRID_H {
                continue;
            }
            // Keys of level-k tiles are multiples of 2^k; anything else is a
            // stray record and would land on the wrong grid cell.
            if *key & ((1u32 << level) - 1) != 0 {
                continue;
            }
            all.push((level, x, y, *no, *off, len));
        }
    }

    let mut levels: Vec<Level> = (0..9).map(|_| Level::default()).collect();
    for (level, x, y, file, offset, len) in all {
        let lv = &mut levels[level as usize];
        let slot = (y as u64) << 32 | x as u64;
        if lv.lookup.contains_key(&slot) {
            continue;
        }
        let idx = lv.tiles.len() as u32;
        lv.lookup.insert(slot, idx);
        lv.tiles.push(TileRef {
            x,
            y,
            file,
            offset,
            len,
        });
        lv.w = lv.w.max((x as u64 + 1) * TILE_W as u64);
        lv.h = lv.h.max((y as u64 + 1) * TILE_H as u64);
    }

    let finest = levels
        .iter()
        .position(|l| !l.tiles.is_empty())
        .ok_or_else(|| "未解析到任何切片".to_string())?;
    let base = &levels[finest];
    let sc = 1u64 << finest;
    let (mut x0, mut y0, mut x1, mut y1) = (u64::MAX, u64::MAX, 0u64, 0u64);
    for t in &base.tiles {
        let px = t.x as u64 * TILE_W as u64;
        let py = t.y as u64 * TILE_H as u64;
        x0 = x0.min(px);
        y0 = y0.min(py);
        x1 = x1.max(px + TILE_W as u64);
        y1 = y1.max(py + TILE_H as u64);
    }
    Ok(SlideIndex {
        w0: base.w * sc,
        h0: base.h * sc,
        bbox0: [x0 * sc, y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc],
        mpp0: mpp_from_ini(dir),
        levels,
    })
}

