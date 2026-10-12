//! Meandris Maps desktop shell.
//!
//! The frontend does almost everything; Rust provides the pieces that must be
//! native: safe (atomic) file writes, reading files the user picked, crash
//! recovery storage and the file passed on the command line.

use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

/// Files macOS asked us to open (Finder "Open With", double-click) before
/// the frontend was ready to receive them. Linux and Windows pass them on
/// the command line instead (see `initial_file`).
#[derive(Default)]
struct PendingOpen(Mutex<VecDeque<String>>);

/// Recovery slots owned by this process. Each slot has a `.lock` file held
/// with an OS lock while the app runs, so another instance never mistakes a
/// live session for a crashed one.
#[derive(Default)]
struct RecoveryLocks(Mutex<HashMap<String, fs::File>>);

/// Writes `bytes` to `path` without ever leaving a half-written file behind:
/// write a temporary file in the same directory, flush it to disk, then
/// atomically rename it over the destination.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .ok_or_else(|| "Invalid file location".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string_lossy()
        .to_string();
    let tmp = dir.join(format!(".{}.{}.tmp", name, std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // Keep the permissions of a file we are replacing.
        if let Ok(meta) = fs::metadata(path) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, path)?;
        #[cfg(unix)]
        if let Ok(d) = fs::File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {name}"))?;
    urlencoding::decode(raw).map(|s| s.into_owned()).map_err(|e| e.to_string())
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("expected binary data".into()),
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_atomic(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    atomic_write(Path::new(&path), raw_body(&request)?)
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("recovery");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn recovery_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("invalid recovery id".into());
    }
    Ok(recovery_dir(app)?.join(format!("{id}.meandrismap")))
}

fn lock_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(recovery_path(app, id)?.with_extension("lock"))
}

/// Takes ownership of a recovery slot. Fails if another running instance owns it.
fn claim(app: &AppHandle, locks: &RecoveryLocks, id: &str) -> Result<(), String> {
    let mut map = locks.0.lock().map_err(|e| e.to_string())?;
    if map.contains_key(id) {
        return Ok(());
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_path(app, id)?)
        .map_err(|e| e.to_string())?;
    file.try_lock().map_err(|_| "recovery slot is in use".to_string())?;
    map.insert(id.to_string(), file);
    Ok(())
}

/// True when no running instance holds the slot's lock.
fn is_abandoned(app: &AppHandle, id: &str) -> bool {
    let Ok(path) = lock_path(app, id) else { return false };
    match OpenOptions::new().create(true).truncate(false).write(true).open(path) {
        Ok(file) => file.try_lock().is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
fn recovery_write(app: AppHandle, locks: State<'_, RecoveryLocks>, request: Request<'_>) -> Result<(), String> {
    let id = header(&request, "x-id")?;
    claim(&app, &locks, &id)?;
    atomic_write(&recovery_path(&app, &id)?, raw_body(&request)?)
}

#[derive(serde::Serialize)]
struct RecoveryEntry {
    id: String,
    /// Milliseconds since the Unix epoch.
    modified: u64,
}

/// Recovery snapshots left behind by instances that are no longer running.
#[tauri::command]
fn recovery_list(app: AppHandle, locks: State<'_, RecoveryLocks>) -> Result<Vec<RecoveryEntry>, String> {
    let owned: Vec<String> = locks.0.lock().map_err(|e| e.to_string())?.keys().cloned().collect();
    let mut out = Vec::new();
    for entry in fs::read_dir(recovery_dir(&app)?).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("meandrismap") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        if owned.iter().any(|o| o == id) || !is_abandoned(&app, id) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(RecoveryEntry { id: id.to_string(), modified });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
fn recovery_read(app: AppHandle, id: String) -> Result<Response, String> {
    fs::read(recovery_path(&app, &id)?).map(Response::new).map_err(|e| e.to_string())
}

/// Takes over an abandoned slot (after the user chose to recover it).
#[tauri::command]
fn recovery_claim(app: AppHandle, locks: State<'_, RecoveryLocks>, id: String) -> Result<(), String> {
    claim(&app, &locks, &id)
}

#[tauri::command]
fn recovery_delete(app: AppHandle, locks: State<'_, RecoveryLocks>, id: String) -> Result<(), String> {
    let owned = locks.0.lock().map_err(|e| e.to_string())?.remove(&id).is_some();
    if !owned && !is_abandoned(&app, &id) {
        return Err("recovery slot is in use".into());
    }
    for path in [recovery_path(&app, &id)?, lock_path(&app, &id)?] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

/// Opens the system print dialog for the window's current (print-styled) page.
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Files the OS asked us to open since the last call (drains the queue).
#[tauri::command]
fn take_pending_files(pending: State<'_, PendingOpen>) -> Vec<String> {
    pending.0.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default()
}

/// A map file to open at startup: one the OS handed us (macOS), or one passed
/// on the command line (Linux "Open with", Windows Explorer double-click,
/// terminal).
#[tauri::command]
fn initial_file(pending: State<'_, PendingOpen>) -> Option<String> {
    if let Some(path) = pending.0.lock().ok().and_then(|mut q| q.pop_front()) {
        return Some(path);
    }
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
        // dunce: on Windows, plain `C:\...` instead of the `\\?\C:\...` form
        // that `fs::canonicalize` returns; identical elsewhere.
        .and_then(|a| dunce::canonicalize(a).ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RecoveryLocks::default())
        .manage(PendingOpen::default())
        .setup(|app| {
            // Created here rather than in tauri.conf.json because clipboard
            // access (needed for Edit → Cut/Copy/Paste on Linux) can only be
            // enabled from Rust.
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Meandris Maps")
                .inner_size(1280.0, 820.0)
                .min_inner_size(640.0, 420.0)
                .disable_drag_drop_handler()
                .enable_clipboard_access()
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file_atomic,
            recovery_write,
            recovery_list,
            recovery_read,
            recovery_claim,
            recovery_delete,
            print_window,
            initial_file,
            take_pending_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building Meandris Maps");

    app.run(|_handle, _event| {
        // macOS delivers documents opened from Finder as an event, not argv.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            use tauri::Emitter;
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if let Some(pending) = _handle.try_state::<PendingOpen>() {
                if let Ok(mut q) = pending.0.lock() {
                    q.extend(paths.iter().cloned());
                }
            }
            // The frontend drains the queue when notified, so nothing opens twice.
            let _ = _handle.emit("open-files", ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_files() {
        let dir = std::env::temp_dir().join(format!("meandrismaps-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("map.meandrismap");
        atomic_write(&file, b"first").unwrap();
        atomic_write(&file, b"second").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"second");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_fails_cleanly_in_missing_directory() {
        let file = std::env::temp_dir().join("meandrismaps-missing-dir-xyz").join("a.meandrismap");
        assert!(atomic_write(&file, b"x").is_err());
    }
}
