//! A single parsed slide plus lazy access to its tile bytes.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::index::{self, SlideIndex, TileRef};

pub struct Slide {
    pub id: String,
    pub name: String,
    pub dir: PathBuf,
    pub index: SlideIndex,
    files: Vec<Mutex<Option<File>>>,
}

impl Slide {
    pub fn open(dir: &Path) -> Result<Slide, String> {
        let idx = index::parse(dir)?;
        let max_file = idx
            .levels
            .iter()
            .flat_map(|l| l.tiles.iter())
            .map(|t| t.file)
            .max()
            .unwrap_or(0);
        let mut files = Vec::with_capacity(max_file as usize + 1);
        for _ in 0..=max_file {
            files.push(Mutex::new(None));
        }
        let name = dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| dir.display().to_string());
        Ok(Slide {
            id: dir.to_string_lossy().to_string(),
            name,
            dir: dir.to_path_buf(),
            index: idx,
            files,
        })
    }

    pub fn level_count(&self) -> usize {
        self.index.levels.iter().filter(|l| !l.tiles.is_empty()).count()
    }

    pub fn tile_count(&self) -> usize {
        self.index.levels.iter().map(|l| l.tiles.len()).sum()
    }

    pub fn file_size(&self) -> u64 {
        std::fs::read_dir(&self.dir)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| {
                        e.file_name()
                            .to_string_lossy()
                            .to_lowercase()
                            .ends_with(".dat")
                    })
                    .filter_map(|e| e.metadata().ok().map(|m| m.len()))
                    .sum()
            })
            .unwrap_or(0)
    }

    fn path_for(&self, file: u32) -> PathBuf {
        self.dir.join(format!("Data{file:04}.dat"))
    }

    pub fn read_tile(&self, t: &TileRef) -> Option<Vec<u8>> {
        let slot = self.files.get(t.file as usize)?;
        let mut guard = slot.lock().ok()?;
        if guard.is_none() {
            *guard = File::open(self.path_for(t.file)).ok();
        }
        let f = guard.as_mut()?;

        // Fast path: the recorded offset/length are exact.
        if let Some(buf) = read_at(f, t.offset, t.len as usize) {
            if is_soi(&buf) {
                return Some(jpeg_slice(buf, 0));
            }
        }

        // Recovery: a few files have their header truncated (or an extra gap
        // inserted) mid-stream, so the recorded offsets drift by a fixed small
        // amount.  Read a window around the recorded offset and snap to the
        // nearest SOI instead of failing the tile.
        const SLACK: u64 = 8192;
        let start = t.offset.saturating_sub(SLACK);
        let want = (t.len as u64 + SLACK * 2) as usize;
        let buf = read_at(f, start, want)?;
        let rel = (t.offset - start) as usize;
        let mut best: Option<usize> = None;
        let mut i = 0usize;
        while i + 3 <= buf.len() {
            if is_soi(&buf[i..]) {
                let d = i.abs_diff(rel);
                if best.map_or(true, |b| d < b.abs_diff(rel)) {
                    best = Some(i);
                }
            }
            i += 1;
        }
        let soi = best?;
        Some(jpeg_slice(buf, soi))
    }

    /// RGBA composite of a coarse level, used for the minimap and list thumbs.
    ///
    /// The coarsest level is mostly white (levels 5–8 are full-slide
    /// rectangles) and some grid cells are genuinely absent from Index.dat,
    /// so: fill with white (the slide background), composite a mid level for
    /// a legible tissue silhouette, and downscale before shipping — a full
    /// level-7 RGBA frame is ~6 MB per call while a 512px thumb is ~1 MB.
    pub fn thumbnail(&self, _kind: &str) -> Option<(u32, u32, Vec<u8>)> {
        // Compositing a level is CPU- and memory-heavy (a level-5 canvas is
        // ~60 MB transient). The sidebar fires one request per slide at
        // startup, so serialize composites to keep the peak flat instead of
        // 16x spikes.
        static THUMB_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _gate = THUMB_GATE.lock().ok();

        let levels = &self.index.levels;
        let budget: u64 = 6_000_000;
        // smallest index == finest resolution: take the FINEST level that
        // stays within budget (max_by_key here would always pick the
        // coarsest qualifying level, i.e. L8, whose spatial content is
        // unreliable). 6 Mpx selects level 6: the finest level whose tile
        // content still matches the level-0 grid (level 5's bbox region is
        // missing the main tissue band on these slides), and pale H&E tissue
        // washes out to white at coarser levels after the downscale.
        let pick = levels
            .iter()
            .enumerate()
            .filter(|(_, l)| !l.tiles.is_empty() && l.w * l.h <= budget)
            .min_by_key(|(i, _)| *i)
            .map(|(i, _)| i)
            .or_else(|| levels.iter().rposition(|l| !l.tiles.is_empty()))?;
        let level = &levels[pick];
        if level.tiles.is_empty() {
            return None;
        }
        let w = level.w as u32;
        let h = level.h as u32;
        // White matches the slide background; missing index cells then read
        // as empty slide instead of a black hole.
        let mut canvas = image::RgbaImage::from_pixel(w, h, image::Rgba([255, 255, 255, 255]));
        for t in &level.tiles {
            let Some(bytes) = self.read_tile(t) else { continue };
            let Ok(img) = image::load_from_memory(&bytes) else {
                continue;
            };
            let rgba = img.to_rgba8();
            image::imageops::replace(
                &mut canvas,
                &rgba,
                t.x as i64 * index::TILE_W as i64,
                t.y as i64 * index::TILE_H as i64,
            );
        }
        // All thumbs crop to the tissue bbox so the strip fills the box
        // instead of drowning in white background. Cropping to the bbox also
        // sidesteps the coarse levels' unreliable spatial alignment: the bbox
        // comes from the level-0 grid, the same space the renderer and the
        // minimap viewport math use, so the thumb spans exactly the bbox.
        let mut out = canvas;
        let sc = 1u64 << pick;
        let [bx, by, bw, bh] = self.index.bbox0;
        let (cx0, cy0, cx1, cy1) = (
            (bx / sc).min(w as u64),
            (by / sc).min(h as u64),
            ((bx + bw) / sc).min(w as u64).max(bx / sc + 1),
            ((by + bh) / sc).min(h as u64).max(by / sc + 1),
        );
        if cx1 > cx0 && cy1 > cy0 && (cx1 < w as u64 || cy1 < h as u64) {
            let crop = image::imageops::crop_imm(
                &out,
                cx0 as u32,
                cy0 as u32,
                (cx1 - cx0) as u32,
                (cy1 - cy0) as u32,
            );
            out = crop.to_image();
        }
        // Downscale so the IPC payload stays small; keep aspect ratio.
        let (w, h) = (out.width(), out.height());
        let max_dim = 512u32;
        if w > max_dim || h > max_dim {
            let s = max_dim as f64 / w.max(h) as f64;
            let nw = ((w as f64 * s).round() as u32).max(1);
            let nh = ((h as f64 * s).round() as u32).max(1);
            let small = image::imageops::resize(&out, nw, nh, image::imageops::FilterType::Triangle);
            return Some((nw, nh, small.into_raw()));
        }
        Some((w, h, out.into_raw()))
    }
}

/// Read up to `len` bytes at `start`, returning whatever is available.
fn read_at(f: &mut File, start: u64, len: usize) -> Option<Vec<u8>> {
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = vec![0u8; len];
    let mut filled = 0usize;
    while filled < buf.len() {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => return None,
        }
    }
    buf.truncate(filled);
    Some(buf)
}

fn is_soi(b: &[u8]) -> bool {
    b.len() >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF
}

/// Slice one JPEG stream starting at `soi`, stopping at its EOI marker.
fn jpeg_slice(buf: Vec<u8>, soi: usize) -> Vec<u8> {
    let mut out = buf;
    let mut i = soi + 2;
    while i + 1 < out.len() {
        if out[i] == 0xFF && out[i + 1] == 0xD9 {
            out.truncate(i + 2);
            break;
        }
        i += 1;
    }
    out.drain(..soi);
    out
}
