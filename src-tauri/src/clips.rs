use crate::i18n::t;
use std::{
    fs::Metadata,
    io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub path: String,
    pub name: String,
    pub game: String,
    pub size: u64,
    pub modified: u64,
    pub created: u64,
}

impl Clip {
    fn from_metadata(path: &Path, game: &str, meta: &Metadata) -> Self {
        let seconds = |time: SystemTime| time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let modified = meta.modified().map(seconds).unwrap_or(0);
        Self {
            path: path.to_string_lossy().into_owned(),
            name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            game: game.into(),
            size: meta.len(),
            modified,
            created: meta.created().map(seconds).unwrap_or(modified),
        }
    }
}

pub fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["mp4", "mkv", "mov"].iter().any(|v| e.eq_ignore_ascii_case(v)))
}

pub fn checked_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let clip = path.canonicalize().map_err(|_| t("error.clipNotFound"))?;
    if clip.starts_with(&root) && clip.is_file() && is_video(&clip) {
        Ok(clip)
    } else {
        Err(t("error.clipOutsideOutput"))
    }
}

pub struct ClipEntry {
    pub path: PathBuf,
    pub target: PathBuf,
    pub relative: PathBuf,
}

/// Resolve the directory separately so a file operation can address the selected
/// symlink itself. Both the directory entry and its target must be inside the root.
pub fn checked_entry(root: &Path, path: &Path) -> Result<ClipEntry, String> {
    let target = checked_path(root, path)?;
    if !is_video(path) {
        return Err(t("error.clipOutsideOutput"));
    }
    let parent = path.parent().ok_or_else(|| t("error.clipOutsideOutput"))?
        .canonicalize().map_err(|e| e.to_string())?;
    let name = path.file_name().ok_or_else(|| t("error.clipNotFound"))?;
    let path = parent.join(name);
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = path.strip_prefix(canonical_root).map_err(|_| t("error.clipOutsideOutput"))?.to_owned();
    Ok(ClipEntry { path, target, relative })
}

fn valid_stem(stem: &str) -> bool {
    if stem.trim().is_empty() || matches!(stem, "." | "..") || stem.contains(['/', '\0']) {
        return false;
    }
    if !cfg!(windows) {
        return true;
    }
    if stem.ends_with(['.', ' ']) || stem.chars().any(|c| c.is_control() || r#"<>:"\|?*"#.contains(c)) {
        return false;
    }
    // Windows treats device names as reserved even when followed by an extension.
    let device = stem.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return false;
    }
    let port = device.strip_prefix("COM").or_else(|| device.strip_prefix("LPT"));
    !matches!(port, Some("1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
}

pub fn rename(root: &Path, path: &Path, stem: &str, recording: Option<&Path>) -> Result<Clip, String> {
    let entry = checked_entry(root, path)?;
    if recording.and_then(|p| p.canonicalize().ok()).as_ref() == Some(&entry.target) {
        return Err(t("error.clipRecording"));
    }
    if !valid_stem(stem) {
        return Err(t("error.clipRenameName"));
    }
    let extension = path.extension().and_then(|e| e.to_str()).ok_or_else(|| t("error.clipRenameName"))?;
    let name = format!("{stem}.{extension}");
    let meta = entry.target.metadata().map_err(|e| e.to_string())?;
    if entry.path.file_name() != Some(name.as_ref()) {
        crate::platform::rename_noreplace(&entry.path, &entry.path.with_file_name(&name)).map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                t("error.clipRenameExists")
            } else {
                e.to_string()
            }
        })?;
    }
    let game = entry.relative.parent().and_then(Path::file_name).unwrap_or_default().to_string_lossy();
    Ok(Clip::from_metadata(&root.join(&entry.relative).with_file_name(name), &game, &meta))
}

fn collect(root: &Path, dir: &Path, game: &str, out: &mut Vec<Clip>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_video(&path) || checked_path(root, &path).is_err() {
            continue;
        }
        let Ok(meta) = path.metadata() else { continue };
        out.push(Clip::from_metadata(&path, game, &meta));
    }
}

pub fn list(root: &Path, recording: Option<&Path>) -> Vec<Clip> {
    let mut clips = Vec::new();
    collect(root, root, "", &mut clips);
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                collect(root, &entry.path(), &entry.file_name().to_string_lossy(), &mut clips);
            }
        }
    }
    if let Some(recording) = recording {
        clips.retain(|c| Path::new(&c.path) != recording);
    }
    clips.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.path.cmp(&b.path)));
    clips
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executable_and_outside_paths_are_rejected_and_canonical_path_returned() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        for path in [root.path().join("x.exe"), outside.path().join("x.mp4"), root.path().join("x.mp4")] {
            std::fs::write(path, b"x").unwrap();
        }
        assert!(checked_path(root.path(), &root.path().join("x.exe")).is_err());
        assert!(checked_path(root.path(), &outside.path().join("x.mp4")).is_err());
        assert_eq!(
            checked_path(root.path(), &root.path().join("./x.mp4")).unwrap(),
            root.path().join("x.mp4").canonicalize().unwrap()
        );
    }

    #[test]
    fn rename_preserves_extension_contents_and_gallery_metadata_while_open() {
        use std::io::Read;
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("My Game");
        std::fs::create_dir(&game).unwrap();
        let original = game.join("round.one.MKV");
        std::fs::write(&original, b"clip data").unwrap();
        let before = list(dir.path(), None).pop().unwrap();
        let mut playing = std::fs::File::open(&original).unwrap();
        let renamed = rename(dir.path(), &original, "Szép kör.2", None).unwrap();
        assert_eq!(Path::new(&renamed.path), game.join("Szép kör.2.MKV"));
        assert_eq!(renamed.game, before.game);
        assert_eq!((renamed.created, renamed.modified, renamed.size), (before.created, before.modified, before.size));
        assert!(!original.exists());
        let mut data = Vec::new();
        playing.read_to_end(&mut data).unwrap();
        assert_eq!(data, b"clip data");

        rename(dir.path(), Path::new(&renamed.path), "szép kör.2", None).unwrap();
        let listed = list(dir.path(), None);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "szép kör.2.MKV");
    }

    #[test]
    fn rename_rejects_collisions_invalid_names_and_active_recordings() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.mp4");
        let other = dir.path().join("other.mp4");
        std::fs::write(&original, b"first").unwrap();
        std::fs::write(&other, b"second").unwrap();
        assert!(rename(dir.path(), &original, "other", None).is_err());
        assert_eq!(std::fs::read(other).unwrap(), b"second");
        for name in ["", "  ", ".", "..", "../escape", "name\0stream"] {
            assert!(rename(dir.path(), &original, name, None).is_err(), "{name}");
        }
        #[cfg(windows)]
        for name in [r"..\escape", "NUL.part", "COM¹", "name:stream"] {
            assert!(rename(dir.path(), &original, name, None).is_err(), "{name}");
        }
        assert!(rename(dir.path(), &original, "new", Some(&original)).is_err());
        assert_eq!(std::fs::read(original).unwrap(), b"first");
    }

    #[test]
    fn older_clips_remain_accessible_beyond_500() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..510 {
            std::fs::write(dir.path().join(format!("{n}.mp4")), b"x").unwrap();
        }
        assert_eq!(list(dir.path(), None).len(), 510);
        assert_eq!(list(dir.path(), Some(&dir.path().join("5.mp4"))).len(), 509);
    }
}
