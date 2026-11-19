//! Accurate A–B export. Decode from the pinned file, then publish a verified sibling atomically.
use crate::{
    clips::Clip,
    i18n::{t, tf},
    media::ExportSource,
    process, resources,
};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tempfile::NamedTempFile;

#[cfg(windows)]
const INPUT: &str = "fd:";
// This also works with distribution FFmpeg versions predating the fd: protocol.
#[cfg(target_os = "linux")]
const INPUT: &str = "/proc/self/fd/0";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub clip: Clip,
    pub original_trashed: bool,
    pub trash_error: Option<String>,
}

fn failed(detail: impl std::fmt::Display) -> String {
    tf("error.clipExportFailed", &[("detail", &detail)])
}

fn encode_error(detail: String) -> String {
    // Both supported FFmpeg generations identify the first mapped (video) stream.
    if detail.contains("Empty output on stream 0.") ||
        detail.lines().any(|line| line.contains("vost#0:0/") && line.contains("Empty output stream")) {
        return t("error.clipExportNoFrame");
    }
    if detail.contains("Unknown encoder 'libx264'") || detail.contains("Unknown encoder 'aac'") {
        return t("error.clipExportEncoder");
    }
    if detail.contains("No space left on device") || detail.contains("There is not enough space on the disk") {
        return t("error.clipExportSpace");
    }
    failed(detail)
}

// The MP4 trailer and FFmpeg's last packet may extend a file past its -fs limit.
const MUX_HEADROOM: u64 = 8 * 1024 * 1024;

fn output_limit(free: u64, source_bytes: u64, fraction: f64) -> Result<u64, String> {
    let estimated = (source_bytes as f64 * fraction.clamp(0.0, 1.0)).ceil() as u64;
    let limit = free.saturating_sub(resources::MIN_FREE_BYTES + MUX_HEADROOM).min(i64::MAX as u64);
    if limit == 0 || estimated > limit { return Err(t("error.clipExportSpace")); }
    Ok(limit)
}

fn valid_range(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && start < end && end < i64::MAX as f64 / 1_000_000.0
}

/// FFprobe is not shipped in the Windows bundle. FFmpeg's demuxer reports the duration
/// to centiseconds and decoding one actual video frame also rejects empty video tracks.
fn inspect(mut command: Command, file: File, cancel: &AtomicBool) -> Result<(f64, f64), String> {
    command.args(["-nostdin", "-hide_banner", "-nostats", "-xerror", "-abort_on", "empty_output"])
        .args(["-threads", "2", "-i", INPUT, "-map", "0:V:0", "-frames:v", "1", "-an", "-f", "null", "-"]);
    let info = process::run_with_input(&mut command, file.into(), Duration::from_secs(45), cancel).map_err(failed)?;
    let duration = info
        .lines()
        .find_map(|line| {
            let value = line.trim_start().strip_prefix("Duration: ")?.split(',').next()?;
            let mut parts = value.split(':');
            let hours: u32 = parts.next()?.parse().ok()?;
            let minutes: u32 = parts.next()?.parse().ok()?;
            let seconds: f64 = parts.next()?.parse().ok()?;
            Some(f64::from(hours) * 3600.0 + f64::from(minutes) * 60.0 + seconds)
        })
        .filter(|n| n.is_finite() && *n > 0.0)
        .ok_or_else(|| t("error.clipExportVerify"))?;
    let frame_interval = info
        .lines()
        .filter(|line| line.contains("Video:"))
        .find_map(|line| {
            let rate: f64 = line.split(" fps").next()?.split_whitespace().last()?.parse().ok()?;
            (rate.is_finite() && rate > 0.0).then_some(1.0 / rate)
        })
        .unwrap_or(1.0 / 30.0);
    Ok((duration, frame_interval))
}

pub fn stage(
    root: &Path,
    source: &ExportSource,
    start: f64,
    end: f64,
    command: impl Fn() -> Option<Command>,
    cancel: &AtomicBool,
) -> Result<NamedTempFile, String> {
    if !valid_range(start, end) {
        return Err(t("error.clipExportRange"));
    }
    let command = || command().ok_or_else(|| t("engine.ffmpegMissing"));
    let (duration, frame_interval) = inspect(command()?, source.reader(root)?, cancel)?;
    if start >= duration + 0.01 || end > duration + 0.01 {
        return Err(t("error.clipExportRange"));
    }
    let path = source.location(root)?;
    let dir = path.parent().ok_or_else(|| t("error.clipNotFound"))?;
    let length = end - start;
    let reader = source.reader(root)?;
    let free = || resources::free_bytes(dir).map_err(|e| tf("engine.diskSpaceUnknown", &[("error", &e)]));
    let limit = output_limit(free()?, reader.metadata().map_err(failed)?.len(), length / duration)?;
    // FFmpeg writes only into this invocation's temporary file. It has no video extension.
    let temp = tempfile::Builder::new().prefix(".clipcat-export-").tempfile_in(dir).map_err(failed)?;
    let mut encoder = command()?;
    encoder.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y", "-abort_on", "empty_output_stream"])
        .args(["-threads", "2", "-ss", &format!("{start:.6}"), "-i", INPUT, "-t", &format!("{length:.6}")])
        .args(["-map", "0:V:0", "-map", "0:a?", "-map_chapters", "-1"])
        .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads:v", "2"])
        .args(["-filter_threads", "1", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p"])
        .args(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-fs", &limit.to_string(), "-f", "mp4"])
        .arg(temp.path());
    let timeout = Duration::from_secs_f64(120.0 + length * 20.0);
    let encoded = process::run_with_input(&mut encoder, reader.into(), timeout, cancel);
    // FFmpeg can exit successfully after hitting -fs. Never publish or recycle on a capped export.
    if temp.as_file().metadata().map_err(failed)?.len() >= limit || free()? < resources::MIN_FREE_BYTES {
        return Err(t("error.clipExportSpace"));
    }
    encoded.map_err(encode_error)?;
    let (output_duration, _) = inspect(command()?, temp.reopen().map_err(failed)?, cancel)?;
    // A muxed range is rounded to video-frame / audio-packet boundaries. Reject incomplete output.
    if (output_duration - length).abs() > frame_interval.max(0.025) + 0.02 {
        return Err(t("error.clipExportVerify"));
    }
    temp.as_file().sync_all().map_err(failed)?;
    Ok(temp)
}

fn sibling(source: &Path, n: u32) -> PathBuf {
    let mut name = source.file_stem().unwrap_or_default().to_os_string();
    name.push(if n == 1 { " trim.mp4".to_string() } else { format!(" trim {n}.mp4") });
    source.with_file_name(name)
}

pub fn publish(mut temp: NamedTempFile, root: &Path, source: &Path) -> Result<Clip, String> {
    let metadata = temp.as_file().metadata().map_err(failed)?;
    let relative = source.strip_prefix(root).map_err(|_| t("error.clipOutsideOutput"))?;
    let game = relative.parent().and_then(Path::file_name).unwrap_or_default().to_string_lossy();
    for n in 1..=u32::MAX {
        let name = sibling(source, n);
        match temp.persist_noclobber(&name) {
            Ok(_) => return Ok(Clip::from_metadata(&name, &game, &metadata)),
            Err(e) if e.error.kind() == io::ErrorKind::AlreadyExists => temp = e.file,
            Err(e) => return Err(failed(e.error)),
        }
    }
    Err(t("error.clipRenameExists"))
}

/// Trash is a separate, opt-in action after publication. A failed recycle leaves the export valid.
pub fn finish(clip: Clip, trash: bool, recycle: impl FnOnce() -> Result<(), String>) -> Exported {
    let trash_error = if trash { recycle().err() } else { None };
    Exported { clip, original_trashed: trash && trash_error.is_none(), trash_error }
}

pub fn recycle_selected(source: &ExportSource, root: &Path, current: &Path) -> Result<(), String> {
    let (source, root, expected) = (source.clone(), root.to_owned(), current.to_owned());
    if crate::platform::recycle_if(&current.to_string_lossy(), move || source.location(&root).is_ok_and(|p| p == expected)) {
        Ok(())
    } else {
        Err(t("error.clipDelete"))
    }
}

pub struct Busy<'a>(pub &'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::Playback;

    fn test_ffmpeg() -> Option<PathBuf> {
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("obs/ffmpeg/ffmpeg.exe");
        let program = if cfg!(windows) && bundled.exists() { bundled } else { PathBuf::from("ffmpeg") };
        Command::new(&program).arg("-version").output().ok()?.status.success().then_some(program)
    }

    #[test]
    fn range_must_be_finite_and_ordered() {
        assert!(valid_range(0.0, 0.04));
        for (a, b) in [(-0.1, 1.0), (1., 1.), (1., 0.), (f64::NAN, 0.1), (0., f64::INFINITY)] {
            assert!(!valid_range(a, b));
        }
    }

    #[test]
    fn disk_budget_includes_the_selection_and_leaves_reserved_space() {
        let reserve = resources::MIN_FREE_BYTES + MUX_HEADROOM;
        assert_eq!(output_limit(reserve + 250, 1000, 0.25).unwrap(), 250);
        assert_eq!(output_limit(reserve + 249, 1000, 0.25), Err(t("error.clipExportSpace")));
        assert_eq!(output_limit(reserve, 0, 0.1), Err(t("error.clipExportSpace")));
        assert_eq!(output_limit(0, 1000, 1.0), Err(t("error.clipExportSpace")));
    }

    #[test]
    fn reports_missing_encoders_and_distinguishes_an_empty_audio_stream() {
        for encoder in ["libx264", "aac"] {
            assert_eq!(encode_error(format!("Unknown encoder '{encoder}'")), t("error.clipExportEncoder"));
        }
        assert_eq!(encode_error("Empty output on stream 0.".into()), t("error.clipExportNoFrame"));
        assert_ne!(encode_error("Empty output on stream 1.".into()), t("error.clipExportNoFrame"));
    }

    #[test]
    fn selection_between_30fps_frames_reports_how_to_expand_it() {
        let Some(ffmpeg) = test_ffmpeg() else { return };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.mp4");
        assert!(Command::new(&ffmpeg).args(["-v", "error", "-f", "lavfi", "-i", "color=s=64x48:r=30:d=1",
            "-c:v", "libx264"]).arg(&path).status().unwrap().success());
        let playback = Playback::default();
        let token = playback.start(dir.path(), &path).unwrap();
        let source = playback.export_source(dir.path(), &token, &path).unwrap();
        let running = AtomicBool::new(false);
        let cut = |a, b| stage(dir.path(), &source, a, b, || Some(Command::new(&ffmpeg)), &running);
        assert_eq!(cut(0.041, 0.042).unwrap_err(), t("error.clipExportNoFrame"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(cut(0.041, 0.09).is_ok());
    }

    #[test]
    fn exports_the_non_keyframe_range_with_optional_audio_and_collision_safe_name() {
        let Some(ffmpeg) = test_ffmpeg() else { return };
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("Game");
        std::fs::create_dir(&game).unwrap();
        for audio in [false, true] {
            let name = if audio { "Clip with audio" } else { "Clip silent" };
            let path = game.join(format!("{name}.mkv"));
            let mut setup = Command::new(&ffmpeg);
            setup.args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=red:s=96x64:r=25:d=2,drawbox=color=blue:w=iw:h=ih:t=fill:enable='gte(t,0.44)'",
            ]);
            if audio {
                setup.args(["-f", "lavfi", "-i", "sine=d=2", "-c:a", "aac"]);
            }
            assert!(setup
                .args(["-c:v", "libx264", "-x264-params", "keyint=100:min-keyint=100:scenecut=0"])
                .arg(&path)
                .status()
                .unwrap()
                .success());
            let bytes = std::fs::read(&path).unwrap();
            let playback = Playback::default();
            let token = playback.start(dir.path(), &path).unwrap();
            let source = playback.export_source(dir.path(), &token, &path).unwrap();
            playback.stop(&token);
            let new_command = || Some(Command::new(&ffmpeg));
            let running = AtomicBool::new(false);
            assert!(stage(dir.path(), &source, 0.4, 42.0, new_command, &running).is_err());
            let stage = stage(dir.path(), &source, 0.48, 0.8, new_command, &running).unwrap();
            let collision = game.join(format!("{name} trim.mp4"));
            std::fs::write(&collision, b"existing export").unwrap();
            let saved = publish(stage, dir.path(), &path).unwrap();
            assert_eq!(saved.name, format!("{name} trim 2.mp4"));
            assert_eq!(saved.game, "Game");
            let first = Command::new(&ffmpeg)
                .args(["-v", "error", "-i"])
                .arg(&saved.path)
                .args([
                    "-map",
                    "0:v:0",
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=1:1",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(first.status.success() && first.stdout[2] > 180 && first.stdout[0] < 40);
            let info = Command::new(&ffmpeg).args(["-hide_banner", "-i"]).arg(&saved.path).output().unwrap();
            let info = String::from_utf8_lossy(&info.stderr);
            assert!(info.contains("Video: h264"));
            assert_eq!(info.contains("Audio: aac"), audio);
            assert!(info.contains("Duration: 00:00:00.32"), "{info}");
            let result = finish(saved, audio, || {
                assert!(audio, "default export cannot recycle");
                assert!(game.join(format!("{name} trim 2.mp4")).exists(), "publish must precede recycling");
                Err("recycle unavailable".into())
            });
            assert!(!result.original_trashed);
            assert_eq!(result.trash_error.is_some(), audio);
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            assert_eq!(std::fs::read(collision).unwrap(), b"existing export");
            assert!(!std::fs::read_dir(&game)
                .unwrap()
                .flatten()
                .any(|p| p.file_name().to_string_lossy().starts_with(".clipcat-export-")));
        }
    }

    #[test]
    fn explicit_recycle_sees_committed_output_and_retains_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("original.mov");
        std::fs::write(&source, b"original").unwrap();
        let stage = NamedTempFile::new_in(dir.path()).unwrap();
        std::io::Write::write_all(&mut stage.as_file(), b"export").unwrap();
        let clip = publish(stage, dir.path(), &source).unwrap();
        let saved = PathBuf::from(&clip.path);
        let recycle_bin = dir.path().join("test-bin");
        let result = finish(clip, true, || {
            assert_eq!(std::fs::read(&saved).unwrap(), b"export");
            std::fs::rename(&source, &recycle_bin).map_err(|err| err.to_string())
        });
        assert!(result.original_trashed && result.trash_error.is_none());
        assert_eq!(result.clip.name, "original trim.mp4");
        assert_eq!(std::fs::read(recycle_bin).unwrap(), b"original");
    }

    #[cfg(windows)]
    #[test]
    fn two_minute_clip_exports_88_to_117_seconds_and_trashes_only_on_request() {
        let Some(ffmpeg) = test_ffmpeg() else { return };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Meccs.mp4");
        assert!(Command::new(&ffmpeg).args(["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=96x64:r=2:d=120",
            "-c:v", "libx264", "-threads", "1"]).arg(&path).status().unwrap().success());
        let playback = Playback::default();
        let token = playback.start(dir.path(), &path).unwrap();
        let source = playback.export_source(dir.path(), &token, &path).unwrap();
        let running = AtomicBool::new(false);
        for trash in [false, true] {
            let stage = stage(dir.path(), &source, 88.0, 117.0, || Some(Command::new(&ffmpeg)), &running).unwrap();
            let clip = publish(stage, dir.path(), &source.location(dir.path()).unwrap()).unwrap();
            let result = finish(clip, trash, || recycle_selected(&source, dir.path(), &path));
            assert!(result.trash_error.is_none());
            assert_eq!(result.original_trashed, trash);
            let (duration, _) = inspect(Command::new(&ffmpeg), File::open(result.clip.path).unwrap(), &running).unwrap();
            assert_eq!(duration, 29.0);
            let mut names: Vec<_> = crate::clips::list(dir.path(), None).into_iter().map(|clip| clip.name).collect();
            names.sort();
            if trash {
                assert_eq!(names, ["Meccs trim 2.mp4", "Meccs trim.mp4"]);
            } else {
                assert_eq!(names, ["Meccs trim.mp4", "Meccs.mp4"]);
            }
        }
    }

    #[test]
    fn source_follows_rename_and_ignores_replacement_even_after_player_closes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.mp4");
        let moved = dir.path().join("renamed.mp4");
        std::fs::write(&path, b"source").unwrap();
        let playback = Playback::default();
        let token = playback.start(dir.path(), &path).unwrap();
        let source = playback.export_source(dir.path(), &token, &path).unwrap();
        playback.stop(&token);
        std::fs::rename(&path, &moved).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        assert_eq!(source.location(dir.path()).unwrap(), moved);
        let mut reader = source.reader(dir.path()).unwrap();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut reader, &mut bytes).unwrap();
        assert_eq!(bytes, b"source");
        let outside = tempfile::tempdir().unwrap();
        assert!(source.location(outside.path()).is_err());
    }

    #[test]
    fn export_tracks_selected_link_across_rename_without_following_a_replacement() {
        #[cfg(target_os = "linux")]
        use std::os::unix::fs::symlink as link;
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file as link;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("data.mp4");
        let alias = dir.path().join("chosen.mp4");
        let renamed = dir.path().join("renamed.mp4");
        std::fs::write(&target, b"source").unwrap();
        let created = link(&target, &alias);
        #[cfg(windows)]
        if created.as_ref().is_err_and(|e| e.raw_os_error() == Some(1314)) {
            return;
        }
        created.unwrap();
        let playback = Playback::default();
        let token = playback.start(dir.path(), &alias).unwrap();
        let source = playback.export_source(dir.path(), &token, &alias).unwrap();
        std::fs::rename(&alias, &renamed).unwrap();
        link(&target, &alias).unwrap();
        assert_eq!(source.location(dir.path()).unwrap(), renamed);
        assert!(alias.is_symlink() && target.is_file());
    }
}
