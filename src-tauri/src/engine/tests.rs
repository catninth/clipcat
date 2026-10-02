use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
pub(super) static TEST_LOCK: Mutex<()> = Mutex::new(());
static ENCODER: AtomicUsize = AtomicUsize::new(0);
static RELEASED: AtomicUsize = AtomicUsize::new(0);
static SHUTDOWN: AtomicUsize = AtomicUsize::new(0);
static RECORD_RELEASED: AtomicUsize = AtomicUsize::new(0);
static RECORD_ACTIVE: AtomicBool = AtomicBool::new(false);
static REPLAY_ACTIVE: AtomicBool = AtomicBool::new(false);
static REPLAY_STARTS: AtomicUsize = AtomicUsize::new(0);
static RECORD_STARTS: AtomicUsize = AtomicUsize::new(0);
static FAIL_START: AtomicBool = AtomicBool::new(false);
static FAIL_AUDIO: AtomicBool = AtomicBool::new(false);
static RECORDED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn config() -> Config {
    Config {
        output_dir: std::env::temp_dir().to_string_lossy().into_owned(),
        buffer_seconds: 150,
        buffer_dir: None,
        base: (1920, 1080),
        output: (1920, 1080),
        fps: 60,
        bitrate_kbps: 30_000,
        hevc: false,
        capture_mode: "game".into(),
        capture_desktop: false,
        monitor_id: String::new(),
        mic_device: "default".into(),
        mic_enabled: false,
    }
}

unsafe extern "C" fn enum_encoders(index: usize, id: *mut *const c_char) -> bool {
    match index {
        0 => {
            *id = c"obs_nvenc_h264_tex".as_ptr();
            true
        }
        1 => {
            *id = c"obs_x264".as_ptr();
            true
        }
        _ => false,
    }
}
unsafe extern "C" fn create_encoder(id: *const c_char, _: *const c_char, _: Ptr, _: Ptr) -> Ptr {
    let value = if CStr::from_ptr(id).to_bytes() == b"obs_x264" { 2 } else { 1 };
    ENCODER.store(value, Ordering::SeqCst);
    value as Ptr
}
unsafe extern "C" fn release(_: Ptr) {
    RELEASED.fetch_add(1, Ordering::SeqCst);
}
unsafe extern "C" fn release_output(output: Ptr) {
    if output as usize == 20 {
        RECORD_RELEASED.fetch_add(1, Ordering::SeqCst);
    }
}
unsafe extern "C" fn shutdown() {
    SHUTDOWN.fetch_add(1, Ordering::SeqCst);
}
unsafe extern "C" fn active(output: Ptr) -> bool {
    match output as usize {
        10 => REPLAY_ACTIVE.load(Ordering::SeqCst),
        20 => RECORD_ACTIVE.load(Ordering::SeqCst),
        _ => false,
    }
}
unsafe extern "C" fn stop(output: Ptr) {
    match output as usize {
        10 => REPLAY_ACTIVE.store(false, Ordering::SeqCst),
        20 => RECORD_ACTIVE.store(false, Ordering::SeqCst),
        _ => (),
    }
}
unsafe extern "C" fn start(output: Ptr) -> bool {
    if FAIL_START.load(Ordering::SeqCst) || ENCODER.load(Ordering::SeqCst) != 2 {
        return false;
    }
    match output as usize {
        10 => {
            REPLAY_ACTIVE.store(true, Ordering::SeqCst);
            REPLAY_STARTS.fetch_add(1, Ordering::SeqCst);
        }
        20 => {
            RECORD_ACTIVE.store(true, Ordering::SeqCst);
            RECORD_STARTS.fetch_add(1, Ordering::SeqCst);
        }
        _ => (),
    }
    true
}

fn fake_api() -> Api {
    let mut api = Api::fake();
    api.obs_enum_encoder_types = enum_encoders;
    api.obs_video_encoder_create = create_encoder;
    api.obs_encoder_release = release;
    api.obs_source_release = release;
    api.obs_output_release = release_output;
    api.obs_shutdown = shutdown;
    api.obs_output_active = active;
    api.obs_output_stop = stop;
    api.obs_output_start = start;
    api
}

fn engine() -> Engine {
    ENCODER.store(0, Ordering::SeqCst);
    RELEASED.store(0, Ordering::SeqCst);
    SHUTDOWN.store(0, Ordering::SeqCst);
    RECORD_RELEASED.store(0, Ordering::SeqCst);
    RECORD_ACTIVE.store(false, Ordering::SeqCst);
    REPLAY_ACTIVE.store(false, Ordering::SeqCst);
    REPLAY_STARTS.store(0, Ordering::SeqCst);
    RECORD_STARTS.store(0, Ordering::SeqCst);
    RECORD_STOP_CODE.store(0, Ordering::SeqCst);
    FAIL_START.store(false, Ordering::SeqCst);
    FAIL_AUDIO.store(false, Ordering::SeqCst);
    RECORDED.lock().unwrap().clear();
    set_event_handler(|event| {
        if let Event::Recorded(path) = event {
            RECORDED.lock().unwrap().push(path);
        }
    });
    SAVE_PENDING.store(false, Ordering::SeqCst);
    REPLAY_WANTED.store(false, Ordering::SeqCst);
    RECORDING_WANTED.store(false, Ordering::SeqCst);
    MONITOR_MODE.store(false, Ordering::SeqCst);
    DESKTOP_WANTED.store(false, Ordering::SeqCst);
    GAME_HOOKED.store(false, Ordering::SeqCst);
    Engine {
        api: Box::leak(Box::new(fake_api())),
        config: config(),
        scene: null_mut(),
        game: null_mut(),
        game_window: None,
        display: null_mut(),
        display_item: null_mut(),
        desktop_audio: null_mut(),
        mic: null_mut(),
        video_encoder: null_mut(),
        audio_encoder: null_mut(),
        output: null_mut(),
        replay_enabled: false,
        afk_paused: false,
        buffer_since: 0,
        record_output: null_mut(),
        record_path: String::new(),
        record_since: 0,
        save_worker: None,
        encoder_index: 0,
        encoder_name: String::new(),
        buffer_seconds: 150,
        memory_buffer_bytes: 0,
        initialized: true,
    }
}

#[cfg(windows)]
#[test]
fn capture_retargets_games_clears_on_focus_loss_and_does_not_restart_unchanged_target() {
    static SETTINGS: Mutex<(String, String, i64)> = Mutex::new((String::new(), String::new(), -1));
    static UPDATES: Mutex<Vec<(String, String, i64)>> = Mutex::new(Vec::new());
    unsafe extern "C" fn set_string(_: Ptr, key: *const c_char, value: *const c_char) {
        let mut settings = SETTINGS.lock().unwrap();
        let value = CStr::from_ptr(value).to_string_lossy().into_owned();
        match CStr::from_ptr(key).to_bytes() {
            b"capture_mode" => settings.0 = value,
            b"window" => settings.1 = value,
            _ => (),
        }
    }
    unsafe extern "C" fn set_int(_: Ptr, key: *const c_char, value: i64) {
        if CStr::from_ptr(key).to_bytes() == b"priority" {
            SETTINGS.lock().unwrap().2 = value;
        }
    }
    unsafe extern "C" fn update(source: Ptr, _: Ptr) {
        assert_eq!(source as usize, 50);
        UPDATES.lock().unwrap().push(SETTINGS.lock().unwrap().clone());
    }

    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    let mut api = Api::fake();
    api.obs_data_set_string = set_string;
    api.obs_data_set_int = set_int;
    api.obs_source_update = update;
    e.api = Box::leak(Box::new(api));
    e.game = 50 as Ptr;
    UPDATES.lock().unwrap().clear();

    e.update_game_window(None); // Fullscreen VLC is not a game target.
    let lol = Some("League of Legends:RiotWindowClass:League of Legends.exe".into());
    e.update_game_window(lol.clone());
    GAME_HOOKED.store(true, Ordering::SeqCst);
    e.update_game_window(lol.clone());
    assert!(GAME_HOOKED.load(Ordering::SeqCst));
    let minecraft = Some("Minecraft:GLFW30:javaw.exe".into());
    e.update_game_window(minecraft.clone());
    assert!(!GAME_HOOKED.load(Ordering::SeqCst));
    GAME_HOOKED.store(true, Ordering::SeqCst);
    e.update_game_window(None); // Alt-tab back to the video player releases the game.
    assert!(!GAME_HOOKED.load(Ordering::SeqCst));
    e.update_game_window(None);
    e.update_game_window(lol.clone());
    GAME_HOOKED.store(true, Ordering::SeqCst);
    e.set_capture_mode("monitor");
    assert!(!GAME_HOOKED.load(Ordering::SeqCst));
    assert!(e.game_window.is_none());
    e.update_game_window(lol.clone()); // Foreground games cannot replace monitor capture.
    e.set_capture_mode("monitor");
    e.set_desktop_visible(true);
    assert!(MONITOR_MODE.load(Ordering::SeqCst));
    e.set_capture_mode("game");
    assert!(e.config.capture_desktop, "switching modes preserves the legacy fallback preference");
    e.update_game_window(lol.clone());

    assert_eq!(*UPDATES.lock().unwrap(), vec![
        ("window".into(), lol.clone().unwrap(), 2),
        ("window".into(), minecraft.unwrap(), 2),
        ("window".into(), String::new(), 2),
        ("window".into(), lol.clone().unwrap(), 2),
        ("window".into(), String::new(), 2),
        ("window".into(), lol.unwrap(), 2),
    ]);
}

#[test]
fn capture_visibility_respects_mode_fallback_hooks_and_both_output_types() {
    static VISIBLE: Mutex<(bool, bool)> = Mutex::new((false, false));
    unsafe extern "C" fn visible(item: Ptr, shown: bool) -> bool {
        let mut state = VISIBLE.lock().unwrap();
        match item as usize {
            40 => state.0 = shown,
            50 => state.1 = shown,
            _ => panic!("unknown scene item"),
        }
        true
    }

    let _serial = TEST_LOCK.lock().unwrap();
    let mut api = Api::fake();
    api.obs_sceneitem_set_visible = visible;
    DISPLAY_ITEM.store(40 as Ptr, Ordering::SeqCst);
    GAME_ITEM.store(50 as Ptr, Ordering::SeqCst);
    for monitor in [false, true] {
        for fallback in [false, true] {
            for hooked in [false, true] {
                for replay in [false, true] {
                    for recording in [false, true] {
                        MONITOR_MODE.store(monitor, Ordering::SeqCst);
                        DESKTOP_WANTED.store(fallback, Ordering::SeqCst);
                        GAME_HOOKED.store(hooked, Ordering::SeqCst);
                        REPLAY_WANTED.store(replay, Ordering::SeqCst);
                        RECORDING_WANTED.store(recording, Ordering::SeqCst);
                        refresh_visibility_with(&api);
                        let capturing = replay || recording;
                        assert_eq!(
                            *VISIBLE.lock().unwrap(),
                            (capturing && (monitor || (fallback && !hooked)), capturing && !monitor),
                            "monitor={monitor}, fallback={fallback}, hooked={hooked}, replay={replay}, recording={recording}",
                        );
                        assert_eq!(GAME_HOOKED.load(Ordering::SeqCst), capturing && !monitor && hooked);
                    }
                }
            }
        }
    }
    DISPLAY_ITEM.store(null_mut(), Ordering::SeqCst);
    GAME_ITEM.store(null_mut(), Ordering::SeqCst);
    REPLAY_WANTED.store(false, Ordering::SeqCst);
    RECORDING_WANTED.store(false, Ordering::SeqCst);
    MONITOR_MODE.store(false, Ordering::SeqCst);
    DESKTOP_WANTED.store(false, Ordering::SeqCst);
}

#[cfg(windows)]
#[test]
fn applying_monitor_selection_updates_display_bounds_and_disables_previous_game_target() {
    static MONITOR: Mutex<String> = Mutex::new(String::new());
    static DISPLAY_UPDATED: AtomicBool = AtomicBool::new(false);
    static GAME_CLEARED: AtomicBool = AtomicBool::new(false);
    static BOUNDS: Mutex<Vec<(usize, f32, f32)>> = Mutex::new(Vec::new());
    unsafe extern "C" fn set_string(_: Ptr, key: *const c_char, value: *const c_char) {
        if CStr::from_ptr(key).to_bytes() == b"monitor_id" {
            *MONITOR.lock().unwrap() = CStr::from_ptr(value).to_string_lossy().into_owned();
        }
    }
    unsafe extern "C" fn update(source: Ptr, _: Ptr) {
        match source as usize {
            40 => DISPLAY_UPDATED.store(true, Ordering::SeqCst),
            50 => GAME_CLEARED.store(true, Ordering::SeqCst),
            _ => panic!("unknown source"),
        }
    }
    unsafe extern "C" fn bounds(item: Ptr, value: *const Vec2) {
        BOUNDS.lock().unwrap().push((item as usize, (*value).x, (*value).y));
    }
    unsafe extern "C" fn create_audio(_: *const c_char, _: *const c_char, _: Ptr, _: usize, _: Ptr) -> Ptr {
        3 as Ptr
    }
    unsafe extern "C" fn create_output(_: *const c_char, _: *const c_char, _: Ptr, _: Ptr) -> Ptr {
        10 as Ptr
    }

    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    let mut api = Api::fake();
    api.obs_enum_encoder_types = enum_encoders;
    api.obs_video_encoder_create = create_encoder;
    api.obs_audio_encoder_create = create_audio;
    api.obs_output_create = create_output;
    api.obs_data_set_string = set_string;
    api.obs_source_update = update;
    api.obs_sceneitem_set_bounds = bounds;
    e.api = Box::leak(Box::new(api));
    e.display = 40 as Ptr;
    e.display_item = 41 as Ptr;
    e.game = 50 as Ptr;
    e.game_window = Some("Game:Window:game.exe".into());
    GAME_ITEM.store(51 as Ptr, Ordering::SeqCst);
    BOUNDS.lock().unwrap().clear();
    DISPLAY_UPDATED.store(false, Ordering::SeqCst);
    GAME_CLEARED.store(false, Ordering::SeqCst);

    let mut changed = config();
    changed.capture_mode = "monitor".into();
    changed.monitor_id = "selected-monitor".into();
    changed.base = (2560, 1440);
    e.apply(&changed).unwrap();

    assert_eq!(*MONITOR.lock().unwrap(), "selected-monitor");
    assert!(DISPLAY_UPDATED.load(Ordering::SeqCst));
    assert!(GAME_CLEARED.load(Ordering::SeqCst));
    assert!(e.game_window.is_none());
    assert!(MONITOR_MODE.load(Ordering::SeqCst));
    assert_eq!(*BOUNDS.lock().unwrap(), vec![(41, 2560.0, 1440.0), (51, 2560.0, 1440.0)]);
}

#[test]
fn missing_encoder_ids_are_skipped_and_failed_hardware_start_reaches_x264() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    assert!(!registered(e.api.obs_enum_encoder_types, "unknown"));
    e.video_encoder = e.create_video_encoder();
    e.output = 10 as Ptr;
    e.start_replay().unwrap();
    assert_eq!(e.encoder_name(), "obs_x264");
    assert_eq!(RELEASED.load(Ordering::SeqCst), 1);
}

#[test]
fn replay_restart_preserves_active_manual_output() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    e.output = 10 as Ptr;
    e.record_output = 20 as Ptr;
    e.desktop_audio = 30 as Ptr;
    e.video_encoder = 2 as Ptr;
    RECORD_ACTIVE.store(true, Ordering::SeqCst);
    ENCODER.store(2, Ordering::SeqCst);
    e.restart().unwrap();
    assert!(e.recording_active());
    assert_eq!(RECORD_RELEASED.load(Ordering::SeqCst), 0);
    let mut changed = config();
    changed.fps = 30;
    assert!(e.apply(&changed).is_err());
    assert_eq!(e.config.fps, 60);
}

#[test]
fn failed_pipeline_construction_releases_partial_objects_on_every_cycle() {
    let _serial = TEST_LOCK.lock().unwrap();
    for _ in 0..100 {
        let mut e = engine();
        // Video succeeds; the fake AAC constructor fails.
        assert!(e.build_pipeline().is_err());
        drop(e);
        assert_eq!(RELEASED.load(Ordering::SeqCst), 1);
        assert_eq!(SHUTDOWN.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn shutdown_waits_for_microphone_borrow_before_releasing_source() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    e.mic = 40 as Ptr;
    let borrow = MIC_SOURCE.lock().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        e.shutdown();
        tx.send(()).unwrap();
    });
    assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
    assert_eq!(RELEASED.load(Ordering::SeqCst), 0);
    drop(borrow);
    worker.join().unwrap();
    assert_eq!(RELEASED.load(Ordering::SeqCst), 1);
}

#[test]
fn stop_joins_pending_disk_save_before_releasing_output() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    let finished = std::sync::Arc::new(AtomicBool::new(false));
    let worker_flag = finished.clone();
    e.save_worker = Some(std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        worker_flag.store(true, Ordering::SeqCst);
    }));
    e.stop_replay();
    assert!(finished.load(Ordering::SeqCst));
    assert!(e.save_worker.is_none());
}

#[test]
fn idle_audio_does_not_create_devices_and_off_releases_mic() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    e.sync_audio().unwrap();
    assert!(e.mic.is_null());
    assert!(e.desktop_audio.is_null());
    e.mic = 40 as Ptr;
    e.desktop_audio = 30 as Ptr;
    e.sync_audio().unwrap();
    assert_eq!(RELEASED.load(Ordering::SeqCst), 2);
    assert!(e.mic.is_null());
    assert!(e.desktop_audio.is_null());
}

#[test]
fn failed_capture_start_clears_intent_and_releases_audio_devices() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    e.video_encoder = 2 as Ptr;
    e.audio_encoder = 3 as Ptr;
    // No registered audio source: startup must roll back even before output creation.
    let dir = tempfile::tempdir().unwrap();
    assert!(e.start_recording(&dir.path().join("failed.mp4")).is_err());
    assert!(!RECORDING_WANTED.load(Ordering::SeqCst));
    assert!(e.mic.is_null());
    assert!(e.desktop_audio.is_null());
    e.output = 10 as Ptr;
    assert!(e.set_replay_enabled(true).is_err());
    assert!(!REPLAY_WANTED.load(Ordering::SeqCst));
    assert!(!e.replay_enabled());
}

#[test]
fn empty_or_failed_recordings_are_not_announced_as_successful() {
    let _serial = TEST_LOCK.lock().unwrap();
    for (content, code, success) in [
        (b"".as_slice(), 0, false),
        (b"partial".as_slice(), -1, false),
        (b"finished".as_slice(), 0, true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.mp4");
        std::fs::write(&path, content).unwrap();
        let mut e = engine();
        e.record_output = 20 as Ptr;
        e.record_path = path.to_string_lossy().into_owned();
        RECORD_ACTIVE.store(true, Ordering::SeqCst);
        RECORD_STOP_CODE.store(code, Ordering::SeqCst);
        assert_eq!(e.stop_recording().is_ok(), success);
        assert!(path.exists(), "failed partial files remain available for recovery");
    }
}

#[test]
fn replay_save_reserves_room_for_the_buffer_and_releases_busy_flag_on_rejection() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = engine();
    e.output = 20 as Ptr;
    RECORD_ACTIVE.store(true, Ordering::SeqCst);
    e.memory_buffer_bytes = u64::MAX; // Force the low-space branch without filling a volume.
    assert!(e.save().is_err());
    assert!(!e.saving());
    RECORD_ACTIVE.store(false, Ordering::SeqCst);
}

/// Working output/audio stubs for inactivity transitions without loading libobs.
fn afk_engine() -> Engine {
    unsafe extern "C" fn enum_audio(index: usize, id: *mut *const c_char) -> bool {
        static IDS: OnceLock<[CString; 2]> = OnceLock::new();
        let ids = IDS.get_or_init(|| [cs(sys::DESKTOP_AUDIO_SOURCE), cs(sys::MIC_SOURCE)]);
        let Some(value) = ids.get(index) else { return false };
        *id = value.as_ptr();
        true
    }
    unsafe extern "C" fn source(_: *const c_char, name: *const c_char, _: Ptr, _: Ptr) -> Ptr {
        if FAIL_AUDIO.load(Ordering::SeqCst) {
            return null_mut();
        }
        if CStr::from_ptr(name).to_bytes() == b"Microphone" { 40 as Ptr } else { 30 as Ptr }
    }
    unsafe extern "C" fn audio(_: *const c_char, _: *const c_char, _: Ptr, _: usize, _: Ptr) -> Ptr {
        3 as Ptr
    }
    unsafe extern "C" fn output(_: *const c_char, name: *const c_char, _: Ptr, _: Ptr) -> Ptr {
        if CStr::from_ptr(name).to_bytes() == b"clipcat_record" { 20 as Ptr } else { 10 as Ptr }
    }

    let mut e = engine();
    let mut api = fake_api();
    api.obs_enum_input_types = enum_audio;
    api.obs_source_create = source;
    api.obs_audio_encoder_create = audio;
    api.obs_output_create = output;
    e.api = Box::leak(Box::new(api));
    e.video_encoder = 2 as Ptr;
    e.audio_encoder = 3 as Ptr;
    e.output = 10 as Ptr;
    e.config.mic_enabled = true;
    ENCODER.store(2, Ordering::SeqCst);
    e
}

#[test]
fn afk_pauses_only_replay_and_preserves_running_manual_video_and_audio() {
    let _serial = TEST_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manual.mp4");
    for replay in [false, true] {
        let mut e = afk_engine();
        e.set_replay_enabled(replay).unwrap();
        e.start_recording(&path).unwrap();
        std::fs::write(&path, b"recording in progress").unwrap();
        let started = e.recording_since();
        let resources = (e.record_output, e.video_encoder, e.audio_encoder, e.desktop_audio, e.mic);

        e.set_afk_paused(true).unwrap();
        assert!(e.afk_paused());
        assert_eq!(e.replay_enabled(), replay);
        assert!(!e.replay_active());
        assert_eq!(e.buffer_since(), 0);
        assert!(!REPLAY_WANTED.load(Ordering::SeqCst));
        assert!(RECORDING_WANTED.load(Ordering::SeqCst));
        assert!(e.recording_active());
        assert_eq!(e.recording_since(), started);
        assert_eq!(e.recording_path(), path.to_str());
        assert_eq!((e.record_output, e.video_encoder, e.audio_encoder, e.desktop_audio, e.mic), resources);
        assert_eq!(RECORD_RELEASED.load(Ordering::SeqCst), 0);
        assert!(RECORDED.lock().unwrap().is_empty());
        e.check_resources().unwrap();
        e.set_afk_paused(true).unwrap();
        e.restart().unwrap();
        assert_eq!(REPLAY_STARTS.load(Ordering::SeqCst), usize::from(replay));

        e.set_afk_paused(false).unwrap();
        assert!(!e.afk_paused());
        assert_eq!(e.replay_active(), replay);
        assert!(e.recording_active());
        assert_eq!(e.recording_since(), started);
        assert_eq!((e.record_output, e.video_encoder, e.audio_encoder, e.desktop_audio, e.mic), resources);
        assert_eq!(REPLAY_STARTS.load(Ordering::SeqCst), 2 * usize::from(replay));
        assert_eq!(RECORD_STARTS.load(Ordering::SeqCst), 1);
        assert!(RECORDED.lock().unwrap().is_empty());
        e.stop_recording().unwrap();
        assert_eq!(RECORDED.lock().unwrap().as_slice(), &[path.to_string_lossy().into_owned()]);
    }
}

#[test]
fn afk_preserves_replay_preferences_without_capturing_during_settings_changes() {
    let _serial = TEST_LOCK.lock().unwrap();
    for initial in [false, true] {
        for desired in [false, true] {
            let mut e = afk_engine();
            e.set_replay_enabled(initial).unwrap();
            e.set_afk_paused(true).unwrap();
            e.set_replay_enabled(desired).unwrap();
            let starts = REPLAY_STARTS.load(Ordering::SeqCst);
            let mut changed = e.config.clone();
            changed.fps = 30;
            e.apply(&changed).unwrap();
            e.restart().unwrap();
            assert!(e.afk_paused());
            assert_eq!(e.replay_enabled(), desired);
            assert!(!e.replay_active());
            assert!(!REPLAY_WANTED.load(Ordering::SeqCst));
            assert!(e.mic.is_null());
            assert!(e.desktop_audio.is_null());
            assert_eq!(REPLAY_STARTS.load(Ordering::SeqCst), starts);

            e.set_afk_paused(false).unwrap();
            assert_eq!(e.replay_active(), desired);
            assert!(!e.recording_active());
        }
    }
}

#[test]
fn afk_transitions_defer_until_an_in_progress_replay_save_finishes() {
    let _serial = TEST_LOCK.lock().unwrap();
    let mut e = afk_engine();
    e.set_replay_enabled(true).unwrap();
    SAVE_PENDING.store(true, Ordering::SeqCst);
    let paused = e.set_afk_paused(true);
    SAVE_PENDING.store(false, Ordering::SeqCst);
    assert!(paused.is_err());
    assert!(!e.afk_paused());
    assert!(e.replay_active());
    assert!(e.replay_enabled());
    assert!(REPLAY_WANTED.load(Ordering::SeqCst));

    e.set_afk_paused(true).unwrap();
    SAVE_PENDING.store(true, Ordering::SeqCst);
    let resumed = e.set_afk_paused(false);
    SAVE_PENDING.store(false, Ordering::SeqCst);
    assert!(resumed.is_err());
    assert!(e.afk_paused());
    assert!(!e.replay_active());
    e.set_afk_paused(false).unwrap();
    assert!(e.replay_active());
}

#[test]
fn manual_recording_can_start_and_stop_while_replay_is_afk_paused() {
    let _serial = TEST_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manual.mp4");
    let mut e = afk_engine();
    e.set_replay_enabled(true).unwrap();
    e.set_afk_paused(true).unwrap();
    assert!(e.desktop_audio.is_null());
    assert!(e.mic.is_null());
    e.start_recording(&path).unwrap();
    std::fs::write(&path, b"manual recording").unwrap();

    assert!(e.afk_paused());
    assert!(e.replay_enabled());
    assert!(!e.replay_active());
    assert!(e.recording_active());
    assert!(!e.desktop_audio.is_null());
    assert!(!e.mic.is_null());
    e.set_replay_enabled(false).unwrap();
    assert!(e.recording_active());
    assert!(!e.desktop_audio.is_null());
    assert!(!e.mic.is_null());

    e.stop_recording().unwrap();
    assert!(e.afk_paused());
    assert!(!e.recording_active());
    assert!(e.desktop_audio.is_null());
    assert!(e.mic.is_null());
    assert_eq!(RECORDED.lock().unwrap().as_slice(), &[path.to_string_lossy().into_owned()]);

    e.set_afk_paused(false).unwrap();
    assert!(!e.replay_active());
    assert!(!e.recording_active());
    assert_eq!(RECORD_STARTS.load(Ordering::SeqCst), 1);
}

#[test]
fn failed_afk_replay_resume_does_not_interrupt_running_manual_recording() {
    let _serial = TEST_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manual.mp4");
    let mut e = afk_engine();
    e.set_replay_enabled(true).unwrap();
    e.start_recording(&path).unwrap();
    std::fs::write(&path, b"manual recording").unwrap();
    let started = e.recording_since();
    let resources = (e.record_output, e.video_encoder, e.audio_encoder, e.desktop_audio, e.mic);
    e.set_afk_paused(true).unwrap();
    FAIL_START.store(true, Ordering::SeqCst);

    assert!(e.set_afk_paused(false).is_err());
    assert!(e.recording_active());
    assert_eq!(e.recording_since(), started);
    assert_eq!((e.record_output, e.video_encoder, e.audio_encoder, e.desktop_audio, e.mic), resources);
    assert!(RECORDING_WANTED.load(Ordering::SeqCst));
    assert!(RECORDED.lock().unwrap().is_empty());
    assert_eq!(RECORD_RELEASED.load(Ordering::SeqCst), 0);
    FAIL_START.store(false, Ordering::SeqCst);
    e.restart().unwrap();
    assert!(e.replay_active());
    assert!(e.recording_active());
    assert_eq!(RECORD_STARTS.load(Ordering::SeqCst), 1);
}

#[test]
fn failed_afk_resume_preserves_replay_intent_for_recovery_and_releases_audio() {
    let _serial = TEST_LOCK.lock().unwrap();
    for fail_audio in [false, true] {
        let mut e = afk_engine();
        e.set_replay_enabled(true).unwrap();
        e.set_afk_paused(true).unwrap();
        FAIL_AUDIO.store(fail_audio, Ordering::SeqCst);
        FAIL_START.store(!fail_audio, Ordering::SeqCst);

        assert!(e.set_afk_paused(false).is_err());
        assert!(!e.afk_paused());
        assert!(e.replay_enabled());
        assert!(!e.replay_active());
        assert!(!e.recording_active());
        assert!(!REPLAY_WANTED.load(Ordering::SeqCst));
        assert!(e.desktop_audio.is_null());
        assert!(e.mic.is_null());

        FAIL_AUDIO.store(false, Ordering::SeqCst);
        FAIL_START.store(false, Ordering::SeqCst);
        e.restart().unwrap();
        assert!(e.replay_active());
        assert_eq!(RECORD_STARTS.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn finalized_recording_is_announced_even_when_audio_sync_fails() {
    let _serial = TEST_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("finished.mp4");
    let mut e = afk_engine();
    e.set_replay_enabled(true).unwrap();
    e.start_recording(&path).unwrap();
    std::fs::write(&path, b"finished recording").unwrap();
    e.desktop_audio = null_mut();
    FAIL_AUDIO.store(true, Ordering::SeqCst);

    assert!(e.stop_recording().is_err());
    assert!(!e.recording_active());
    assert_eq!(RECORDED.lock().unwrap().as_slice(), &[path.to_string_lossy().into_owned()]);
}
