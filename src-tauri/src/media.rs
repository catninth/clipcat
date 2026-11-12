//! Video-only protocol. Every request uses the CURRENT root, so old roots lose access immediately.
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::http::{Request, Response};
const CHUNK: u64 = 1024 * 1024;
const PLAYBACK_PREFIX: &str = "playback:";

// The webview requests many independent byte ranges. Keep one open handle for the player's
// lifetime so a seek still reads the same file after Explorer renames it or reuses its old name.
struct PlayingFile {
    file: Mutex<File>,
    opened_link: Option<PathBuf>,
}
impl tauri::Resource for PlayingFile {}

#[derive(Default)]
pub struct Playback(Mutex<tauri::ResourceTable>);

impl Playback {
    pub fn start(&self, root: &Path, path: &Path) -> Result<String, String> {
        let entry = crate::clips::checked_entry(root, path)?;
        let opened_link = entry.path.is_symlink().then(|| root.join(entry.relative));
        // Rust's Windows File::open shares READ | WRITE | DELETE (the latter allows renaming).
        let file = File::open(entry.target).map_err(|e| e.to_string())?;
        let id = self.0.lock().unwrap().add(PlayingFile { file: Mutex::new(file), opened_link });
        Ok(format!("{PLAYBACK_PREFIX}{id}"))
    }

    fn file(&self, token: &str) -> Result<std::sync::Arc<PlayingFile>, String> {
        token.strip_prefix(PLAYBACK_PREFIX)
            .and_then(|id| id.parse().ok())
            .and_then(|id| self.0.lock().unwrap().get::<PlayingFile>(id).ok())
            .ok_or_else(|| crate::i18n::t("error.clipNotFound"))
    }

    pub fn resolve(&self, root: &Path, token: &str, gallery_path: Option<&Path>) -> Result<PathBuf, String> {
        let file = self.file(token)?;
        let playing = scoped_handle_path(root, &file.file.lock().unwrap())?;
        if let Some(opened_link) = &file.opened_link {
            // A link and its target can both appear in the gallery. File actions must
            // stay on the selected link, even after it is renamed in the player.
            let entry = crate::clips::checked_entry(root, gallery_path.unwrap_or(opened_link))?;
            if !entry.path.is_symlink() || playing.canonicalize().ok() != Some(entry.target) {
                return Err(crate::i18n::t("error.clipNotFound"));
            }
            return Ok(root.join(entry.relative));
        }
        Ok(playing)
    }

    pub fn stop(&self, token: &str) {
        if let Some(id) = token.strip_prefix(PLAYBACK_PREFIX).and_then(|id| id.parse().ok()) {
            let _ = self.0.lock().unwrap().take::<PlayingFile>(id);
        }
    }

    pub fn clear(&self) {
        *self.0.lock().unwrap() = tauri::ResourceTable::default();
    }
}

#[cfg(windows)]
fn handle_path(file: &File) -> io::Result<PathBuf> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;

    let mut name = vec![0u16; 512];
    loop {
        // Flags 0 requests the normalized DOS path, matching Path::canonicalize on Windows.
        let len = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle(), name.as_mut_ptr(), name.len() as u32, 0) };
        if len == 0 {
            return Err(io::Error::last_os_error());
        }
        if (len as usize) < name.len() {
            return Ok(std::ffi::OsString::from_wide(&name[..len as usize]).into());
        }
        // When the buffer is too small the returned size includes the terminating NUL.
        name.resize(len as usize, 0);
    }
}

#[cfg(target_os = "linux")]
fn handle_path(file: &File) -> io::Result<PathBuf> {
    use std::os::fd::AsRawFd;
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

fn scoped_handle_path(root: &Path, file: &File) -> Result<PathBuf, String> {
    let path = handle_path(file).map_err(|_| crate::i18n::t("error.clipNotFound"))?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = path.strip_prefix(canonical_root).ok().filter(|p| crate::clips::is_video(p))
        .ok_or_else(|| crate::i18n::t("error.clipOutsideOutput"))?;
    // Match list_clips' path spelling, including the configured root without a verbatim prefix.
    Ok(root.join(relative))
}

fn range(value: &str, length: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if length == 0 || end.contains(',') {
        return None;
    }
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        (length.saturating_sub(suffix), length - 1)
    } else {
        let start = start.parse::<u64>().ok()?;
        (
            start,
            if end.is_empty() {
                length - 1
            } else {
                end.parse::<u64>().ok()?.min(length - 1)
            },
        )
    };
    if start >= length || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(CHUNK - 1))))
}

fn error(status: u16) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}

pub fn response(playback: &Playback, root: &Path, request: Request<Vec<u8>>, allowed: bool) -> Response<Vec<u8>> {
    if !allowed || !matches!(request.method().as_str(), "GET" | "HEAD") {
        return error(403);
    }
    let decoded = percent_encoding::percent_decode_str(request.uri().path().trim_start_matches('/')).decode_utf8();
    let Ok(path) = decoded else { return error(400) };
    if path.starts_with(PLAYBACK_PREFIX) {
        let Ok(playing) = playback.file(&path) else { return error(404) };
        let mut file = playing.file.lock().unwrap();
        let Ok(path) = scoped_handle_path(root, &file) else { return error(403) };
        return file_response(&path, &mut file, &request);
    }
    let Ok(path) = crate::clips::checked_path(root, Path::new(path.as_ref())) else {
        return error(403);
    };
    let Ok(mut file) = File::open(&path) else { return error(404) };
    file_response(&path, &mut file, &request)
}

fn file_response(path: &Path, file: &mut File, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Ok(meta) = file.metadata() else { return error(500) };
    let length = meta.len();
    let mime = match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        _ => "video/mp4",
    };
    let mut builder = Response::builder()
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "Content-Range")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if request.method() == "HEAD" {
        return builder.header("Content-Length", length).body(Vec::new()).unwrap();
    }
    let bounds = match request.headers().get("Range") {
        Some(header) => header.to_str().ok().and_then(|value| range(value, length)),
        None if length <= CHUNK => Some((0, length.saturating_sub(1))),
        // Browsers request videos in ranges. Never allocate a multi-GB clip for a plain GET.
        None => None,
    };
    let Some((start, end)) = bounds else {
        return builder
            .status(416)
            .header("Content-Range", format!("bytes */{length}"))
            .body(Vec::new())
            .unwrap();
    };
    let count = if length == 0 { 0 } else { end - start + 1 };
    if request.headers().contains_key("Range") {
        builder = builder.status(206).header("Content-Range", format!("bytes {start}-{end}/{length}"));
    }
    let mut body = Vec::with_capacity(count as usize);
    if file.seek(SeekFrom::Start(start)).is_err() || file.take(count).read_to_end(&mut body).is_err() {
        return error(500);
    }
    builder.header("Content-Length", body.len()).body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_are_bounded_and_invalid_ranges_rejected() {
        assert_eq!(range("bytes=0-", 10 * CHUNK), Some((0, CHUNK - 1)));
        assert_eq!(range("bytes=-20", 100), Some((80, 99)));
        for value in ["bytes=100-", "bytes=9-1", "bytes=-0", "bytes=1-2,3-4", "garbage"] {
            assert!(range(value, 100).is_none());
        }
    }
    #[test]
    fn switching_root_revokes_old_video_and_toast_has_no_access() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        let clip = old.path().join("clip.mp4");
        std::fs::write(&clip, b"test video").unwrap();
        let uri = format!(
            "clipcat://localhost/{}",
            percent_encoding::utf8_percent_encode(&clip.to_string_lossy(), percent_encoding::NON_ALPHANUMERIC)
        );
        let req = || Request::builder().uri(&uri).header("Range", "bytes=0-3").body(Vec::new()).unwrap();
        let playback = Playback::default();
        let result = response(&playback, old.path(), req(), true);
        assert_eq!(result.status(), 206);
        assert_eq!(result.body(), b"test");
        assert_eq!(response(&playback, new.path(), req(), true).status(), 403);
        assert_eq!(response(&playback, old.path(), req(), false).status(), 403);
    }

    #[test]
    fn file_actions_preserve_the_selected_link_and_reject_a_different_target() {
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file as link;
        #[cfg(target_os = "linux")]
        use std::os::unix::fs::symlink as link;
        let root = tempfile::tempdir().unwrap();
        let movie = root.path().join("movie.mp4");
        let alias = root.path().join("alias.mp4");
        std::fs::write(&movie, b"video").unwrap();
        let result = link(&movie, &alias);
        // Windows can require Developer Mode or SeCreateSymbolicLinkPrivilege.
        #[cfg(windows)]
        if result.as_ref().is_err_and(|e| e.raw_os_error() == Some(1314)) {
            eprintln!("Skipping symlink fixture: this account cannot create Windows symlinks");
            return;
        }
        result.unwrap();
        let playback = Playback::default();
        let token = playback.start(root.path(), &alias).unwrap();
        assert_eq!(playback.resolve(root.path(), &token, None).unwrap(), alias);
        let renamed = crate::clips::rename(root.path(), &alias, "highlight", None).unwrap();
        let renamed = Path::new(&renamed.path);
        assert!(renamed.is_symlink() && !alias.exists());
        assert_eq!(playback.resolve(root.path(), &token, Some(renamed)).unwrap(), renamed);
        assert!(playback.resolve(root.path(), &token, Some(&movie)).is_err());
        let other = root.path().join("other.mp4");
        std::fs::write(&other, b"other").unwrap();
        link(&other, &alias).unwrap();
        assert!(playback.resolve(root.path(), &token, Some(&alias)).is_err());
        let outside = tempfile::tempdir().unwrap();
        let outside_alias = outside.path().join("outside.mp4");
        link(&movie, &outside_alias).unwrap();
        assert!(playback.resolve(root.path(), &token, Some(&outside_alias)).is_err());
        // Delete passes this exact directory entry to the recycle bin.
        let entry = crate::clips::checked_entry(root.path(), renamed).unwrap();
        std::fs::remove_file(entry.path).unwrap();
        assert_eq!(std::fs::read(movie).unwrap(), b"video");
    }

    #[test]
    fn playback_survives_external_rename_and_ignores_replacement_at_old_name() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let original = root.path().join("old.mp4");
        let renamed = root.path().join("new.mp4");
        std::fs::write(&original, b"original video").unwrap();
        let playback = Playback::default();
        let token = playback.start(root.path(), &original).unwrap();
        let request = || Request::builder().uri(format!("clipcat://localhost/{token}"))
            .header("Range", "bytes=4-7").body(Vec::new()).unwrap();
        std::fs::rename(&original, &renamed).unwrap();
        std::fs::write(&original, b"replacement video").unwrap();
        assert_eq!(playback.resolve(root.path(), &token, Some(&original)).unwrap(), renamed);
        let seek = response(&playback, root.path(), request(), true);
        assert_eq!(seek.status(), 206);
        assert_eq!(seek.body(), b"inal");
        assert_eq!(response(&playback, outside.path(), request(), true).status(), 403);
        assert_eq!(response(&playback, root.path(), request(), false).status(), 403);
        std::fs::rename(renamed, outside.path().join("moved.mp4")).unwrap();
        assert_eq!(response(&playback, root.path(), request(), true).status(), 403);
        playback.stop(&token);
        assert_eq!(response(&playback, root.path(), request(), true).status(), 404);
    }
}
