//! Data-integrity probe: `cargo run --release --example validate -- <DATA root>`
//!
//! Parses every slide, checks the level pyramid and JPEG markers, and prints a
//! table. This is the executable form of the assertions in the task document.

use std::fs;
use std::path::Path;

use tt_slideviewer_lib::index::{self, TILE_H, TILE_W};
use tt_slideviewer_lib::slide::Slide;

fn main() {
    let root = std::env::args().nth(1).expect("usage: validate <DATA root>");
    let root = Path::new(&root);
    let mut dirs: Vec<_> = fs::read_dir(root)
        .expect("DATA root")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("Index.dat").exists())
        .collect();
    dirs.sort();

    let mut failures = 0usize;
    let mut total_tiles = 0usize;
    for dir in dirs {
        let name = dir.file_name().unwrap().to_string_lossy().to_string();
        match Slide::open(&dir) {
            Ok(slide) => {
                let idx = &slide.index;
                let levels: Vec<String> = idx
                    .levels
                    .iter()
                    .enumerate()
                    .filter(|(_, l)| !l.tiles.is_empty())
                    .map(|(i, l)| format!("L{}:{}({}x{})", i, l.tiles.len(), l.w, l.h))
                    .collect();
                let mut checked = 0;
                let mut bad = 0;
                for (li, l) in idx.levels.iter().enumerate() {
                    if l.tiles.is_empty() {
                        continue;
                    }
                    let step = (l.tiles.len() / 6).max(1);
                    for t in l.tiles.iter().step_by(step) {
                        checked += 1;
                        if let Some(b) = slide.read_tile(t) {
                            if b.len() < 128 || b[0] != 0xFF || b[1] != 0xD8 {
                                bad += 1;
                            }
                            if b[b.len() - 2] != 0xFF || b[b.len() - 1] != 0xD9 {
                                bad += 1;
                            }
                        } else {
                            bad += 1;
                            eprintln!("  missing tile L{li} {} {} file {} off {}", t.x, t.y, t.file, t.offset);
                        }
                    }
                }
                total_tiles += slide.tile_count();
                let ok = idx.levels.iter().filter(|l| !l.tiles.is_empty()).count() == 9
                    && bad == 0;
                if !ok {
                    failures += 1;
                }
                println!(
                    "{} {} | {} | mpp {:.4} | canvas {}x{} | bbox {:?} | checked {} bad {}",
                    if ok { "OK  " } else { "FAIL" },
                    name,
                    levels.join(" "),
                    idx.mpp0,
                    idx.w0,
                    idx.h0,
                    idx.bbox0,
                    checked,
                    bad
                );
                // canvas consistency: every level's visible extent must stay
                // inside the level-0 canvas once scaled back.  Coarse levels
                // are whole-slide overviews that may include extra padding, so
                // only a *shortfall* is a problem.
                for (li, l) in idx.levels.iter().enumerate() {
                    if l.tiles.is_empty() {
                        continue;
                    }
                    let w0 = l.w << li;
                    let h0 = l.h << li;
                    if w0 + (1 << li) * TILE_W as u64 * 2 < idx.w0
                        || h0 + (1 << li) * TILE_H as u64 * 2 < idx.h0
                    {
                        println!("     note: L{li} extent {w0}x{h0} covers less than canvas");
                    }
                }
                let _ = (TILE_W, TILE_H);
            }
            Err(e) => {
                failures += 1;
                println!("FAIL {name} | {e}");
            }
        }
    }
    println!(
        "\n{} slides, {} tiles, {} failures",
        dirs_len(&root),
        total_tiles,
        failures
    );
    let _ = index::TILE_W;
    if failures > 0 {
        std::process::exit(1);
    }
}

fn dirs_len(root: &Path) -> usize {
    fs::read_dir(root)
        .map(|rd| rd.flatten().filter(|e| e.path().join("Index.dat").exists()).count())
        .unwrap_or(0)
}
