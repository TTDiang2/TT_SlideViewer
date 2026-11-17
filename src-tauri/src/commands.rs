//! IPC commands exposed to the frontend.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Response, AppHandle, Manager, State};

use crate::slide::Slide;

#[derive(Default)]
pub struct Store {
    slides: HashMap<String, Arc<Slide>>,
}

pub struct AppState {
    pub store: Mutex<Store>,
}

impl AppState {
    pub fn get(&self, id: &str) -> Result<Arc<Slide>, String> {
        let mut guard = self.store.lock().map_err(|_| "状态锁失败".to_string())?;
        if let Some(s) = guard.slides.get(id) {
            return Ok(s.clone());
        }
        let dir = PathBuf::from(id);
        if !dir.join("Index.dat").exists() {
            return Err(format!("不是有效的切片目录: {id}"));
        }
        let slide = Arc::new(Slide::open(&dir)?);
        guard.slides.insert(id.to_string(), slide.clone());
        Ok(slide)
    }
}

#[derive(Serialize)]
pub struct SlideMeta {
    pub id: String,
    pub name: String,
    pub case_no: String,
    pub site: String,
    pub tooth: String,
    pub levels: usize,
    pub tiles: usize,
    pub mpp: f64,
    pub width: u64,
    pub height: u64,
    pub size_mb: u64,
}

#[derive(Serialize)]
pub struct LevelInfo {
    pub level: u8,
    pub tiles: usize,
    pub width: u64,
    pub height: u64,
    pub mpp: f64,
}

#[derive(Serialize)]
pub struct SlideInfo {
    pub id: String,
    pub name: String,
    pub case_no: String,
    pub site: String,
    pub tooth: String,
    pub mpp: f64,
    /// layer-0 canvas
    pub width: u64,
    pub height: u64,
    /// tissue bounding box in layer-0 pixels
    pub bbox: [u64; 4],
    pub levels: Vec<LevelInfo>,
    pub size_mb: u64,
}

fn split_name(name: &str) -> (String, String, String) {
    let parts: Vec<&str> = name.split_whitespace().collect();
    // Case number: prefer a pure-digit token, fall back to the first token.
    let case_no = parts
        .iter()
        .find(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        .or_else(|| parts.first())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let mut site = String::new();
    let mut tooth = String::new();
    for p in parts.iter().rev() {
        let lower = p.to_lowercase();
        if p.contains('腭') || p.contains('龈') || lower.contains("palate") || lower.contains("gingiva") {
            site = p.to_string();
            break;
        }
    }
    for p in &parts {
        let up = p.to_uppercase();
        if up.len() >= 2
            && up.starts_with('G')
            && up[1..].chars().all(|c| c.is_ascii_digit())
        {
            tooth = up;
            break;
        }
    }
    (case_no, site, tooth)
}

fn meta_of(s: &Slide) -> SlideMeta {
    let (case_no, site, tooth) = split_name(&s.name);
    SlideMeta {
        id: s.id.clone(),
        name: s.name.clone(),
        case_no,
        site,
        tooth,
        levels: s.level_count(),
        tiles: s.tile_count(),
        mpp: s.index.mpp0,
        width: s.index.bbox0[2],
        height: s.index.bbox0[3],
        size_mb: s.file_size() / (1024 * 1024),
    }
}

#[tauri::command]
pub async fn list_slides(state: State<'_, AppState>, root: String) -> Result<Vec<SlideMeta>, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("目录不存在: {}", root.display()));
    }
    let mut dirs: Vec<PathBuf> = Vec::new();
    for ent in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let p = ent.path();
        if p.is_dir() && p.join("Index.dat").exists() {
            dirs.push(p);
        }
    }
    dirs.sort_by_key(|p| {
        p.file_name()
            .and_then(|s| s.to_string_lossy().split_whitespace().next().map(|t| t.to_string()))
            .and_then(|t| t.parse::<u32>().ok())
            .unwrap_or(u32::MAX)
    });
    let mut out = Vec::new();
    for d in dirs {
        let id = d.to_string_lossy().to_string();
        match state.get(&id) {
            Ok(s) => out.push(meta_of(&s)),
            Err(e) => eprintln!("skip {id}: {e}"),
        }
    }
    Ok(out)
}

/// Warm the parse cache in the background so opening a slide is instant.
#[tauri::command]
pub async fn warm_slides(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    let mut guard = state.store.lock().map_err(|_| "状态锁失败".to_string())?;
    for id in ids {
        if guard.slides.contains_key(&id) {
            continue;
        }
        if let Ok(s) = Slide::open(Path::new(&id)) {
            guard.slides.insert(id, Arc::new(s));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn slide_info(state: State<'_, AppState>, id: String) -> Result<SlideInfo, String> {
    let s = state.get(&id)?;
    let (case_no, site, tooth) = split_name(&s.name);
    let levels = s
        .index
        .levels
        .iter()
        .enumerate()
        .filter(|(_, l)| !l.tiles.is_empty())
        .map(|(i, l)| LevelInfo {
            level: i as u8,
            tiles: l.tiles.len(),
            width: l.w,
            height: l.h,
            mpp: s.index.mpp0 * (1u64 << i) as f64,
        })
        .collect();
    Ok(SlideInfo {
        id: s.id.clone(),
        name: s.name.clone(),
        case_no,
        site,
        tooth,
        mpp: s.index.mpp0,
        width: s.index.w0,
        height: s.index.h0,
        bbox: s.index.bbox0,
        levels,
        size_mb: s.file_size() / (1024 * 1024),
    })
}

#[tauri::command]
pub async fn get_tiles(
    state: State<'_, AppState>,
    id: String,
    level: u8,
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
) -> Result<Response, String> {
    let slide = state.get(&id)?;
    let level_idx = (level as usize).min(8);
    let lv = &slide.index.levels[level_idx];
    let mut frame: Vec<u8> = Vec::with_capacity(4096);
    frame.extend_from_slice(&0u32.to_le_bytes());
    let mut count = 0u32;
    if !lv.tiles.is_empty() {
        let (mut a, mut b) = (x0, y0);
        let (mut c, mut d) = (x1, y1);
        if a > c {
            std::mem::swap(&mut a, &mut c);
        }
        if b > d {
            std::mem::swap(&mut b, &mut d);
        }
        'outer: for y in b..=d {
            for x in a..=c {
                if count >= 600 {
                    break 'outer;
                }
                let Some(t) = lv.get(x, y) else { continue };
                let Some(bytes) = slide.read_tile(t) else { continue };
                frame.extend_from_slice(&x.to_le_bytes());
                frame.extend_from_slice(&y.to_le_bytes());
                frame.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                frame.extend_from_slice(&bytes);
                count += 1;
            }
        }
    }
    frame[0..4].copy_from_slice(&count.to_le_bytes());
    Ok(Response::new(frame))
}

/// Returns `[u32 width][u32 height][RGBA pixels]` for a coarse composite.
#[tauri::command]
pub async fn slide_thumb(
    state: State<'_, AppState>,
    id: String,
    kind: String,
) -> Result<Response, String> {
    let slide = state.get(&id)?;
    match slide.thumbnail(&kind) {
        Some((w, h, px)) => {
            let mut out = Vec::with_capacity(px.len() + 8);
            out.extend_from_slice(&w.to_le_bytes());
            out.extend_from_slice(&h.to_le_bytes());
            out.extend_from_slice(&px);
            Ok(Response::new(out))
        }
        None => Ok(Response::new(Vec::new())),
    }
}

#[tauri::command]
pub fn default_root() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(v) = std::env::var("TT_SLIDE_DATA_ROOT") {
        candidates.push(PathBuf::from(v));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut p = exe.clone();
        for _ in 0..4 {
            if let Some(parent) = p.parent() {
                p = parent.to_path_buf();
                candidates.push(p.join("DATA"));
                candidates.push(p.join("data"));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("DATA"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("DATA"));
        }
    }
    for c in candidates {
        if c.is_dir()
            && fs::read_dir(&c)
                .map(|rd| {
                    rd.flatten()
                        .any(|e| e.path().is_dir() && e.path().join("Index.dat").exists())
                })
                .unwrap_or(false)
        {
            return Some(c.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn save_export(path: String, bytes_b64: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_b64.trim())
        .map_err(|e| format!("图像解码失败: {e}"))?;
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&p, &bytes).map_err(|e| format!("写入失败: {e}"))?;
    Ok(p.to_string_lossy().to_string())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn load_annotations(app: AppHandle) -> Result<String, String> {
    let p = data_dir(&app)?.join("annotations.json");
    Ok(fs::read_to_string(p).unwrap_or_else(|_| "{}".to_string()))
}

#[tauri::command]
pub fn save_annotations(app: AppHandle, json: String) -> Result<(), String> {
    let p = data_dir(&app)?.join("annotations.json");
    // validate before writing so a bug never corrupts the store
    let _: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub root: String,
    #[serde(default = "default_cache")]
    pub cache_mb: u32,
    #[serde(default = "default_zoom")]
    pub default_zoom: String,
    /// "light" | "dark" | "system" (empty = system)
    #[serde(default)]
    pub theme: String,
}

fn default_cache() -> u32 {
    400
}
fn default_zoom() -> String {
    "fit".into()
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let p = data_dir(&app)?.join("settings.json");
    Ok(fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let p = data_dir(&app)?.join("settings.json");
    let s = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(p, s).map_err(|e| e.to_string())
}
