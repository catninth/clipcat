# ClipCat compatibility and encoders

This guide describes ClipCat by Cat Ninth at the current source revision. It separates
published packages and implemented capture paths from hardware that has actually been
tested. No versioned manual OS/GPU test matrix has been published in this repository.

[Download ClipCat](https://github.com/catninth/clipcat/releases/latest)
· [Quick start](../README.md#quick-start-save-your-first-clip)
· [User guide](https://catninth.com/guides/clipcat/)

## Packages and runtime requirements

The stable **v0.8.1** release, checked on October 26, 2026, contains these packages.
Use the latest-release link above for newer versions, rather than assuming these
filenames remain current.

| System | Published v0.8.1 asset | Runtime requirements |
| --- | --- | --- |
| Windows x86_64 | `ClipCat_0.8.1_x64-setup.exe` | OBS and FFmpeg components are included by the installer. The UI uses WebView2. A separate OBS scene setup is unnecessary. |
| Linux x86_64, Debian-style package | `ClipCat_0.8.1_amd64.deb` | Install through the package manager to resolve dependencies, including `obs-studio`, `ffmpeg`, and `pulseaudio-utils`. |
| Linux x86_64, RPM package | `ClipCat-0.8.1-1.x86_64.rpm` | Install through the package manager; the package requires `obs-studio`, `/usr/bin/ffmpeg`, and `/usr/bin/pactl`. |
| Linux x86_64, AppImage | `ClipCat_0.8.1_amd64.AppImage` | Mark the downloaded file executable. System OBS Studio, FFmpeg, audio services, and a compatible WebKitGTK 4.1 environment are still required. |
| macOS / ARM | None | No official release package or manual compatibility result is documented. |

Package availability does not certify every Windows version, Linux distribution,
desktop, or GPU. The CI workflow builds and checks Windows and Linux code; it is not
a live game-recording test on every supported capture path. Record the actual OS
version and graphics driver when reporting success or failure.

See [release assets](https://github.com/catninth/clipcat/releases/tag/v0.8.1), the
[release workflow](../.github/workflows/release.yml),
[Linux package dependencies](../src-tauri/tauri.linux.conf.json), and the
[code-signing policy](../CODE_SIGNING.md).

## Linux capture and input

| Session or feature | Implemented behavior | Limit |
| --- | --- | --- |
| X11 screen capture | Uses the OBS X11 screen source. | Requires a working X11 session and the relevant OBS capture module. |
| Wayland screen capture | Uses OBS's PipeWire screen-sharing portal. | The system portal controls permission and display selection; the app's monitor selector cannot override it. |
| Automatic game capture | Windows has game capture hooks; Linux uses screen capture. | Windows-style game hooks are unavailable on Linux. Use **Monitor capture** for an initial Linux test. |
| Foreground app detection and push-to-talk key state | Linux implementation uses X11/XWayland facilities. | Native Wayland applications and pure Wayland sessions can lack the required information. |
| Global shortcuts | Registered through the application's global-shortcut integration. | Availability depends on the desktop session. If a shortcut cannot register or trigger, use **Save now** and the sidebar controls. |
| Pause replay when AFK | Uses Windows session input or X11 ScreenSaver idle time. | Disabled on Wayland; controller-only input does not reset the idle timeout. |

Check desktop audio and microphone playback in a short saved clip before relying on
a long recording. A running buffer alone does not confirm that the desired audio
device or screen was captured.

Sources: [Linux capture engine](../src-tauri/src/engine/linux.rs),
[Linux platform integration](../src-tauri/src/platform/linux.rs), and
[recording controls](../README.md#recording-controls).

## Encoder selection

The engine tries available encoders in order. The following table records source
behavior, **not a list of successfully tested GPU models**.

| Platform | Hardware candidates | Fallback and limits |
| --- | --- | --- |
| Windows | NVIDIA NVENC, H.264 or HEVC according to the selected codec. | Falls back to `obs_x264` CPU encoding. The current Windows candidate list does not include AMD AMF or Intel Quick Sync. |
| Linux | NVIDIA NVENC, then VAAPI, using the corresponding H.264 or HEVC encoder. | Falls back to `obs_x264` CPU encoding. Availability depends on the installed OBS modules, GPU, and driver. |
| CPU fallback | `obs_x264` | Encodes H.264, including when the requested hardware HEVC encoder is unavailable; it is not a software HEVC fallback. CPU load can increase. |

Look at the **Encoder** status in the sidebar and test the resulting file in your
intended player or editor. Choosing HEVC in Settings does not prove that HEVC encoding
started. No GPU-specific performance or compatibility claim should be inferred from
the encoder list.

Sources: [Windows candidates](../src-tauri/src/engine/windows.rs),
[Linux candidates](../src-tauri/src/engine/linux.rs), and
[encoder creation and fallback](../src-tauri/src/engine/mod.rs).

## Buffer and storage limits

| Mode | Behavior | Practical limit |
| --- | --- | --- |
| Memory (RAM), the default | Keeps the replay in memory without rolling segment files. | The safe memory budget can reduce the requested duration. Low available memory can prevent buffering. |
| Disk | Writes rolling MKV segments into a separate session folder and assembles a saved clip using FFmpeg. | Requires writable storage and free space; it writes even when no clip is saved. Saving can take longer. |

Replay length accepts **10–1200 seconds**, but a newly started buffer only contains
footage captured since it started. Changing capture-pipeline settings, including
capture mode or monitor, rebuilds the buffer and discards its unsaved content. Save
the current moment before changing those settings.

The save folder stores finished videos; the buffer folder stores temporary segments.
ClipCat reserves at least **1 GiB** of free space for capture and does not delete
finished clips to make room. Keep extra space for the clips you intend to save.
After a crash, disk-buffer session folders can remain; see
[storage and retention](../PRIVACY.md#storage-and-retention) before cleaning them up.

Sources: [settings validation](../src-tauri/src/settings.rs),
[memory and disk budgets](../src-tauri/src/resources.rs), and
[disk buffer implementation](../src-tauri/src/engine/disk.rs).

## Add a verified hardware result

Follow the [real replay demonstration procedure](REPLAY_DEMO.md) and record the exact
ClipCat version or commit, OS version, session type, GPU and driver, selected and
actual encoder, recording settings, and resulting playback. Report an untested
configuration as untested. A successful build, simulated screenshot, or encoder
appearing in a menu is not a successful capture result.
