//! Lossless clip trimming: stream copy into a temp file, so a failed cut leaves the original untouched.
use crate::{
    engine,
    i18n::{t, tf},
    platform, resources,
};
use std::{
    ffi::OsStr,
    fs::File,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::AtomicBool,
    time::Duration,
};

const MIN_LENGTH: f64 = 1.0;
const TRIM_TIMEOUT: Duration = Duration::from_secs(600);

fn valid_range(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end - start >= MIN_LENGTH
}

/// Same folder and stem as the clip; keeps the original bytes of non-UTF-8 names.
fn sibling(source: &Path, suffix: &str) -> PathBuf {
    let mut name = source.file_stem().unwrap_or_default().to_os_string();
    name.push(suffix);
    source.with_file_name(name)
}

fn free_name(source: &Path) -> PathBuf {
    let first = sibling(source, " (trimmed).mp4");
    if !first.exists() {
        return first;
    }
    (2u32..)
        .map(|n| sibling(source, &format!(" (trimmed {n}).mp4")))
        .find(|path| !path.exists())
        .unwrap_or(first)
}

fn cut(mut command: Command, source: &Path, temp: &Path, start: f64, end: f64, cancel: &AtomicBool) -> Result<(), String> {
    command
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(["-ss", &format!("{start:.3}"), "-to", &format!("{end:.3}")])
        .arg("-i")
        .arg(source)
        .args([
            "-map",
            "0:v",
            "-map",
            "0:a?",
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(temp);
    crate::process::run(&mut command, TRIM_TIMEOUT, cancel)?;
    if temp.metadata().is_ok_and(|m| m.len() > 0) {
        Ok(())
    } else {
        Err("empty output".into())
    }
}

/// Swap in the finished copy; if the last rename fails, the copy survives under its trimmed name.
fn replace_original(source: &Path, trimmed: PathBuf, recycle: impl Fn(&OsStr) -> bool) -> Result<PathBuf, String> {
    let modified = source.metadata().and_then(|m| m.modified()).ok();
    if !recycle(source.as_os_str()) {
        let _ = std::fs::remove_file(&trimmed);
        return Err(t("error.clipDelete"));
    }
    let target = source.with_extension("mp4");
    if target.exists() || std::fs::rename(&trimmed, &target).is_err() {
        return Ok(trimmed);
    }
    if let Some(modified) = modified {
        // Keeps the clip's place in the gallery, which sorts by this time
        let _ = File::options().write(true).open(&target).and_then(|f| f.set_modified(modified));
    }
    Ok(target)
}

/// Keep `start..end` of the clip, as a new file or in place of the original.
pub fn trim(source: &Path, start: f64, end: f64, replace: bool, cancel: &AtomicBool) -> Result<PathBuf, String> {
    if !valid_range(start, end) {
        return Err(t("error.trimRange"));
    }
    let command = engine::ffmpeg_command().ok_or_else(|| t("engine.ffmpegMissing"))?;
    let dir = source.parent().ok_or_else(|| t("error.clipNotFound"))?;
    let size = source.metadata().map_err(|_| t("error.clipNotFound"))?.len();
    resources::require_space(dir, resources::MIN_FREE_BYTES.saturating_add(size))?;
    // No video extension: a gallery refresh during the cut must not list this file
    let temp = sibling(source, ".trimming.tmp");
    if let Err(detail) = cut(command, source, &temp, start, end, cancel) {
        let _ = std::fs::remove_file(&temp);
        return Err(tf("engine.ffmpegFailed", &[("detail", &detail)]));
    }
    let trimmed = free_name(source);
    if let Err(error) = std::fs::rename(&temp, &trimmed) {
        let _ = std::fs::remove_file(&temp);
        return Err(tf("engine.ffmpegFailed", &[("detail", &error)]));
    }
    if replace {
        replace_original(source, trimmed, |path| platform::recycle(&path.to_string_lossy()))
    } else {
        Ok(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_must_be_finite_ordered_and_long_enough() {
        assert!(valid_range(0.0, 1.0));
        assert!(valid_range(2.5, 10.0));
        assert!(!valid_range(-0.1, 5.0));
        assert!(!valid_range(5.0, 5.5));
        assert!(!valid_range(5.0, 2.0));
        assert!(!valid_range(f64::NAN, 5.0));
        assert!(!valid_range(0.0, f64::INFINITY));
    }

    #[test]
    fn free_name_skips_existing_clips() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Replay 1.2.mp4");
        assert_eq!(free_name(&source), dir.path().join("Replay 1.2 (trimmed).mp4"));
        std::fs::write(dir.path().join("Replay 1.2 (trimmed).mp4"), b"x").unwrap();
        std::fs::write(dir.path().join("Replay 1.2 (trimmed 2).mp4"), b"x").unwrap();
        assert_eq!(free_name(&source), dir.path().join("Replay 1.2 (trimmed 3).mp4"));
    }

    fn remove(path: &OsStr) -> bool {
        std::fs::remove_file(path).is_ok()
    }

    /// The test binary has no engine folder beside it, so look in the source tree and on PATH.
    fn test_ffmpeg() -> Option<PathBuf> {
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("obs/ffmpeg/ffmpeg.exe");
        let program = if bundled.exists() { bundled } else { PathBuf::from("ffmpeg") };
        Command::new(&program).arg("-version").output().ok()?.status.success().then_some(program)
    }

    #[test]
    fn cut_keeps_the_selected_part_with_video_and_audio() {
        let Some(ffmpeg) = test_ffmpeg() else { return };
        let dir = tempfile::tempdir().unwrap();
        // Canonical like a validated clip path: a verbatim path on Windows
        let dir = dir.path().canonicalize().unwrap();
        let source = dir.join("clip with spaces.mp4");
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=30:duration=8"])
            .args(["-f", "lavfi", "-i", "sine=duration=8", "-c:v", "mpeg4", "-g", "15", "-c:a", "aac"])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());

        let temp = sibling(&source, ".trimming.tmp");
        cut(Command::new(&ffmpeg), &source, &temp, 2.0, 5.0, &AtomicBool::new(false)).unwrap();

        // `ffmpeg -i` without an output prints the file's details, then exits with an error
        let info = Command::new(&ffmpeg).arg("-hide_banner").arg("-i").arg(&temp).output().unwrap();
        let info = String::from_utf8_lossy(&info.stderr).into_owned();
        assert!(info.contains("Video: mpeg4") && info.contains("Audio: aac"), "{info}");
        let seconds: f64 = info
            .split("Duration: 00:00:")
            .nth(1)
            .and_then(|rest| rest.split(',').next())
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("{info}"));
        assert!((3.0..=3.6).contains(&seconds), "{info}");
    }

    #[test]
    fn replacing_takes_the_original_name_and_time() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("clip.mp4");
        let trimmed = dir.path().join("clip (trimmed).mp4");
        std::fs::write(&source, b"old").unwrap();
        std::fs::write(&trimmed, b"new").unwrap();
        let time = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        File::options().write(true).open(&source).unwrap().set_modified(time).unwrap();

        assert_eq!(replace_original(&source, trimmed.clone(), remove).unwrap(), source);
        assert_eq!(std::fs::read(&source).unwrap(), b"new");
        assert_eq!(source.metadata().unwrap().modified().unwrap(), time);
        assert!(!trimmed.exists());
    }

    #[test]
    fn failed_recycle_keeps_the_original_and_drops_the_copy() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("clip.mp4");
        let trimmed = dir.path().join("clip (trimmed).mp4");
        std::fs::write(&source, b"old").unwrap();
        std::fs::write(&trimmed, b"new").unwrap();

        assert!(replace_original(&source, trimmed.clone(), |_| false).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"old");
        assert!(!trimmed.exists());
    }

    #[test]
    fn replacing_another_container_never_overwrites_a_neighbouring_clip() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("clip.mkv");
        let neighbour = dir.path().join("clip.mp4");
        let trimmed = dir.path().join("clip (trimmed).mp4");
        std::fs::write(&source, b"old").unwrap();
        std::fs::write(&neighbour, b"other").unwrap();
        std::fs::write(&trimmed, b"new").unwrap();

        assert_eq!(replace_original(&source, trimmed.clone(), remove).unwrap(), trimmed);
        assert_eq!(std::fs::read(&neighbour).unwrap(), b"other");
    }
}
