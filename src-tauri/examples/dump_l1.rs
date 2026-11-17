//! Dump raw L1 tiles around a seam and compose them by index coordinates.
//! `cargo run --release --example dump_l1 -- <slide dir> <out dir>`

use std::path::Path;

use tt_slideviewer_lib::index::{TILE_H, TILE_W};
use tt_slideviewer_lib::slide::Slide;

fn main() {
    let dir = std::env::args()
        .nth(1)
        .expect("usage: dump_l1 <slide dir> [out dir]");
    let out_dir = std::env::args().nth(2).unwrap_or_else(|| ".".into());
    let dir = Path::new(&dir);
    let slide = Slide::open(dir).expect("open slide");
    let lv = &slide.index.levels[1]; // L1, step 2, tiles cover 606x506 layer-0 px

    let (x0, x1, y0, y1) = (48u32, 54u32, 68u32, 75u32);
    let mut compose =
        image::RgbaImage::new(((x1 - x0 + 1) * TILE_W) as u32, ((y1 - y0 + 1) * TILE_H) as u32);
    let mut dumped = 0usize;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let Some(t) = lv.get(x, y) else { continue };
            let Some(bytes) = slide.read_tile(t) else { continue };
            let Ok(img) = image::load_from_memory(&bytes) else { continue };
            img.save(format!(
                "{}\\tile_L1_{:03}_{:03}.png",
                out_dir.replace('\\', "/"),
                x,
                y
            ))
            .ok();
            image::imageops::replace(
                &mut compose,
                &img.to_rgba8(),
                ((x - x0) * TILE_W) as i64,
                ((y - y0) * TILE_H) as i64,
            );
            dumped += 1;
        }
    }
    compose
        .save(format!("{}\\compose_L1.png", out_dir.replace('\\', "/")))
        .expect("save compose");
    println!("dumped {dumped} tiles, compose -> compose_L1.png");
}
