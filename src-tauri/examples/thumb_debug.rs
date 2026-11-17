//! Coarse-level decode probe:
//! `cargo run --release --example thumb_debug -- <slide dir>`
//!
//! Prints per-level stats and per-tile decode results for the coarsest
//! levels, and writes thumbnail composites to the current directory.

use std::collections::HashMap;
use std::path::Path;

use tt_slideviewer_lib::index::{self, TILE_H, TILE_W};
use tt_slideviewer_lib::slide::Slide;

fn main() {
    let dir = std::env::args()
        .nth(1)
        .expect("usage: thumb_debug <slide dir>");
    let dir = Path::new(&dir);
    let slide = Slide::open(dir).expect("open slide");
    let idx = &slide.index;

    println!(
        "w0={} h0={} bbox={:?} mpp={}",
        idx.w0, idx.h0, idx.bbox0, idx.mpp0
    );
    for (i, lv) in idx.levels.iter().enumerate() {
        if lv.tiles.is_empty() {
            continue;
        }
        let mut files: HashMap<u32, usize> = HashMap::new();
        for t in &lv.tiles {
            *files.entry(t.file).or_insert(0) += 1;
        }
        println!(
            "level {i}: {:>5} tiles  {:>6}x{:<6} files {:?}",
            lv.tiles.len(),
            lv.w,
            lv.h,
            files
        );
    }

    for want in [6u8, 7u8] {
        let lv = &idx.levels[want as usize];
        if lv.tiles.is_empty() {
            println!("-- level {want}: empty, skip");
            continue;
        }
        println!("-- level {want} per-tile decode:");
        let mut ok = 0usize;
        let mut read_fail = 0usize;
        let mut dec_fail = 0usize;
        let mut canvas = image::RgbaImage::from_pixel(
            lv.w as u32,
            lv.h as u32,
            image::Rgba([255, 0, 255, 255]),
        );
        for t in &lv.tiles {
            let bytes = slide.read_tile(t);
            let dec = bytes.as_ref().and_then(|b| image::load_from_memory(b).ok());
            match (&bytes, &dec) {
                (Some(b), Some(img)) => {
                    ok += 1;
                    println!(
                        "  ({:>3},{:>3}) off={:>9} len={:>7} read={} dec={}x{}",
                        t.x,
                        t.y,
                        t.offset,
                        t.len,
                        b.len(),
                        img.width(),
                        img.height()
                    );
                    let rgba = img.to_rgba8();
                    image::imageops::replace(
                        &mut canvas,
                        &rgba,
                        t.x as i64 * TILE_W as i64,
                        t.y as i64 * TILE_H as i64,
                    );
                }
                (Some(b), None) => {
                    dec_fail += 1;
                    println!(
                        "  ({:>3},{:>3}) off={:>9} len={:>7} read={} DECODE-FAIL first={:02x}{:02x}{:02x}",
                        t.x,
                        t.y,
                        t.offset,
                        t.len,
                        b.len(),
                        b[0],
                        b[1],
                        b[2]
                    );
                }
                (None, _) => {
                    read_fail += 1;
                    println!(
                        "  ({:>3},{:>3}) off={:>9} len={:>7} READ-FAIL",
                        t.x, t.y, t.offset, t.len
                    );
                }
            }
        }
        println!(
            "  level {want}: ok={ok} read_fail={read_fail} decode_fail={dec_fail}"
        );
        let out = format!("thumb_L{want}.png");
        canvas.save(&out).expect("save composite");
        println!("  composite -> {}", out);
    }

    // dump the actual thumbnail() outputs the app would ship
    for kind in ["list", "minimap"] {
        if let Some((w, h, px)) = slide.thumbnail(kind) {
            let img = image::RgbaImage::from_raw(w, h, px).expect("dims");
            let name = format!("ship_{kind}.png");
            img.save(&name).expect("save");
            // count non-white rows for a quick content read
            let mut nonwhite = 0usize;
            for p in img.pixels() {
                if !(p[0] > 238 && p[1] > 238 && p[2] > 238) {
                    nonwhite += 1;
                }
            }
            println!("ship {kind}: {w}x{h} nonwhite={nonwhite} -> {name}");
        }
    }
}
