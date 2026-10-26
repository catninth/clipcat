# ClipCat — Open-source instant replay recorder

ClipCat by Cat Ninth is an open-source gameplay and screen recorder for Windows and Linux.
Save recent gameplay with a hotkey using a rolling replay buffer, with a local clipping
workflow similar to ShadowPlay Instant Replay or Medal.

Choose RAM or disk buffering, set a replay length from 10 seconds to 20 minutes, and
browse saved videos in the built-in clip gallery and player. Available memory, disk
space, and time since capture started can limit the footage actually retained.

No ClipCat account is required, and the app does not upload your clips. It does check
GitHub for updates. ClipCat's own source is licensed under MPL-2.0; OBS, FFmpeg, and
other dependencies retain their [own licenses](#license).

**[Download the latest release](https://github.com/catninth/clipcat/releases/latest)**
· [Product page and user guide](https://catninth.com/guides/clipcat/)
· [Screenshots](docs/gallery/README.md)
· [FAQ](#faq)
· [Privacy notice](PRIVACY.md)

**Magyarul:** Nyílt forráskódú játékklip-rögzítő Windowsra és Linuxra.
Gyorsbillentyűvel mentheted az előző másodpercek vagy percek eseményeit.
A felület magyarul és angolul is használható.

## Quick start: save your first clip

1. Download and install the package for your system from the [latest release](https://github.com/catninth/clipcat/releases/latest).
   See [platform support](#platform-support) below for Linux dependencies.
2. Open **Settings**. Choose the **Save folder**, **Capture mode**, monitor, replay
   length, and audio settings, then save. New installations use **Monitor capture**
   with the microphone off; the selected display can include other apps and notifications.
3. **Turn on the replay switch in the sidebar.** Replay is off on a new installation.
   Wait for **Replay buffer running**, then let the buffer collect the moment you want
   to keep. It cannot recover footage from before capture started.
4. Press **Alt+F10** or select **Save now**. Wait for the save to finish, then open the
   clip in **Gallery**. **Alt+F11** opens the latest clip's folder.

For a full session, **Alt+F9** starts or stops manual recording independently of replay.
Shortcuts are configurable under **Settings → Keyboard shortcuts**; see
[Linux session limitations](docs/COMPATIBILITY.md#linux-capture-and-input) if a hotkey
is unavailable. The [first-clip guide](https://catninth.com/guides/clipcat/first-clip/)
walks through the workflow.

## Platform support

| Platform | Package on the release page | Capture requirements |
| --- | --- | --- |
| Windows x86_64 | `_x64-setup.exe` installer | Includes OBS capture components and FFmpeg; uses Microsoft WebView2. |
| Linux x86_64 | `.deb`, `.rpm`, or `.AppImage` | Requires system OBS Studio, FFmpeg, and a compatible WebKitGTK 4.1 environment. An AppImage does not bundle away these requirements. |
| macOS / ARM | No official package currently published | Not a verified release target. |

Linux uses X11 screen capture or the Wayland PipeWire portal, without Windows-style
capture hooks. Native Wayland applications have input and game-detection limitations.
Read [compatibility and encoders](docs/COMPATIBILITY.md) before choosing a capture setup.
Published packages and automated build checks are not a tested OS/GPU compatibility matrix.

## Screenshots

<p align="center">
  <a href="docs/gallery/gallery/overview.png">
    <img src="docs/gallery/gallery/overview.png" alt="ClipCat gallery with game filters, clip previews, and replay controls" width="100%">
  </a>
</p>

<p align="center">
  <a href="docs/gallery/player/playback.png">
    <img src="docs/gallery/player/playback.png" alt="ClipCat built-in video player and clip actions" width="49%">
  </a>
  <a href="docs/gallery/settings/capture.png">
    <img src="docs/gallery/settings/capture.png" alt="ClipCat capture settings for replay length, quality, and desktop recording" width="49%">
  </a>
</p>

<p align="center">
  <a href="docs/gallery/settings/push-to-talk.png">
    <img src="docs/gallery/settings/push-to-talk.png" alt="ClipCat microphone, push-to-talk, and keyboard shortcuts" width="49%">
  </a>
  <a href="docs/gallery/settings/disk-buffer.png">
    <img src="docs/gallery/settings/disk-buffer.png" alt="ClipCat disk buffer settings for longer replays" width="49%">
  </a>
</p>

<p align="center">
  <a href="docs/gallery/README.md"><strong>Browse the full feature gallery →</strong></a>
</p>

Screenshots show the English UI with sample clips and simulated capture state. See the gallery for all 28 images and capture details.

## Why ClipCat?

- **Keep a moment after it happens.** Enable replay once, then save the available
  recent footage with a shortcut. [Replay controls](docs/gallery/recording/buffer-filling.png).
- **Choose where the buffer lives.** Use RAM for a memory buffer or disk for rolling
  segment files. Disk mode writes continuously and takes time to assemble a saved clip.
  [Buffer settings](docs/gallery/settings/disk-buffer.png).
- **Find and replay local clips.** Browse application groups and thumbnails, play a
  video, or reveal it in your file manager. [Gallery](docs/gallery/gallery/overview.png)
  and [player](docs/gallery/player/playback.png).

## FAQ

### Can I use ClipCat as an open-source ShadowPlay or Medal alternative?

Yes, for the local instant replay workflow: keep recent footage buffered, save it with
an adjustable hotkey, and review it in a gallery. It also supports manual recording,
desktop audio, and an optional microphone. It does not provide a social feed, built-in
clip uploads, or a timeline video editor. This is a description of ClipCat's scope,
not a claim of feature parity with those products.

### Where are my clips saved? Do I need an account?

The default is a **ClipCat** folder inside your system Videos folder. Change it with
**Settings → Save folder**. Clips are grouped by application and remain until you move
or delete them; ClipCat does not automatically delete completed clips to reclaim space.
There is no ClipCat account or built-in upload service. A cloud-synchronized save
folder can still upload files through other software. See [Privacy](PRIVACY.md).

### Does ClipCat work offline?

Recording and local playback do not require a ClipCat account or upload service.
The app makes automatic update requests to GitHub, so it is not network-silent.
Update installation is user-triggered. See [Releases and updates](#releases-and-updates)
for the distinction between released and unreleased updater behavior.

### How long can I save, and which buffer should I use?

The setting accepts **10–1200 seconds**. RAM is the default; its safe memory budget can
shorten the actual replay length. Disk mode needs FFmpeg and writable storage, writes
continuously, and needs additional space for completed clips. A newly started buffer
only contains footage recorded since it started. See [buffer limits](docs/COMPATIBILITY.md#buffer-and-storage-limits).

### Which GPU and Linux session should I use?

The source selects NVENC on Windows and NVENC or VAAPI on Linux when available, with
an x264 CPU fallback. That is an encoder selection policy, not verification of every
GPU. The [compatibility guide](docs/COMPATIBILITY.md) describes the requirements,
Wayland limits, and the evidence still needed for a hardware test matrix.

### Is there a real capture demonstration?

The [feature gallery](docs/gallery/README.md) shows the real interface with sample
clips and simulated capture state. It does not verify live recording. Use the
[replay demonstration checklist](docs/REPLAY_DEMO.md) to record and document an actual
buffer → save → playback run, including the version, OS, GPU, and encoder.

### Which ClipCat is this?

This is **ClipCat by Cat Ninth**, maintained at
[`catninth/clipcat`](https://github.com/catninth/clipcat): an OBS-powered game replay
recorder built with Tauri, Rust, and React. Its project background has been described
as “vibe-coded”; supported features and limits are documented here and in the source.

## License

ClipCat's own source code is licensed under the [Mozilla Public License 2.0](LICENSE).
Third-party components retain their own licenses; this does not relicense OBS/libobs,
FFmpeg, vendored glib, or other dependencies. Windows packages include upstream OBS
and FFmpeg binaries selected by [bundle-obs.ps1](bundle-obs.ps1); Linux packages use
system OBS and FFmpeg. Consult the respective [OBS](https://github.com/obsproject/obs-studio),
[FFmpeg](https://ffmpeg.org/legal.html), and
[Windows FFmpeg build](https://github.com/GyanD/codexffmpeg) license and source notices,
and the retained [vendored glib license](src-tauri/vendor/glib/LICENSE).

## Recording controls

Assign **Toggle replay buffer** under **Settings → Keyboard shortcuts** to turn replay
on or off from any app. It starts unassigned; press Backspace or Delete while capturing
the shortcut to clear it. The shortcut, sidebar switch, and tray control share the same
saved replay state and show an enabled/disabled popup using the notification preferences.
Manual recordings continue independently.

Recording settings accept custom replay lengths (10–1200 seconds) and integer bitrates
(5 Mbps up to the existing frame-rate limit), alongside the sliders.

**Pause replay when AFK** is off by default, including for existing installations.
Choose 10 or 30 minutes, 1, 2, or 3 hours, or enter a custom timeout of 10–86400 seconds.
When no keyboard or mouse input is detected for that long, ClipCat pauses replay.
Manual recordings continue with video and audio unaffected. Input resumes replay only
if it was enabled before the pause. Turning the AFK setting off also releases the pause.
Replay saves already in progress finish before the replay buffer is paused.
Idle detection uses Windows session input or the X11 ScreenSaver extension on Linux;
Wayland idle detection is unavailable. Controller-only input does not reset the timeout.

## Language and Info

The **Capture mode** dropdown offers **Monitor capture** and **Automatic game capture**.
Monitor recording always captures the selected display, including games and other apps. Select
the primary monitor automatically or choose a connected monitor; unavailable selections fall
back to the primary display. Replay clips use the application active when Save is pressed for
their filename and folder. Manual recordings use the application active when recording stops.
Known games keep their friendly names; other apps use their executable names for stable groups.
Changing the mode or monitor clears the replay buffer and is blocked during manual recording.
On Wayland, the system screen-sharing portal controls display selection.

Automatic game capture preserves the previous game-detection behavior and saved desktop fallback
preference. Existing installations keep this mode; new installations start in monitor mode.

The **Language** field in Settings switches between Hungarian and English US. On first launch,
the Windows display language determines the default: Hungarian for Hungarian Windows, English US otherwise.
A saved manual selection is retained for subsequent launches. After saving, the UI, tray menu, and notifications
switch languages without restarting.

The **Info** section at the bottom of Settings contains the version, update check, license link,
and GitHub icon. The repository is [catninth/clipcat](https://github.com/catninth/clipcat).
The License button opens ClipCat's [MPL-2.0 license file](https://github.com/catninth/clipcat/blob/main/LICENSE).

## Releases and updates

Use [GitHub Releases](https://github.com/catninth/clipcat/releases/latest) for installers;
you do not need the development toolchain below. The release history and
[Changelog](CHANGELOG.md) separate published changes from **Unreleased** work.
As of October 26, 2026, the latest stable release is **v0.8.1**. Its update checks use
the GitHub REST API; the public-manifest change described below is still unreleased.

ClipCat uses the shared [`catninth-updater`](https://github.com/catninth/updater)
Rust library. It checks the public `latest.json` asset from `catninth/clipcat` after
20 seconds, then every six hours, without using the rate-limited GitHub REST API.
It displays the manifest's notes, which match the GitHub release body.
Installation is user-triggered and uses the selected tag's `latest.json` manifest
to locate packages and their Minisign signatures:
NSIS on Windows, AppImage replacement or `.deb`/`.rpm` installation through `pkexec`
on Linux. Recording and clip-saving guards remain in ClipCat.
See [the updater integration guide](docs/updater.md) for configuration and lifecycle details.

To publish a new version:

1. Bump the version in `src-tauri/Cargo.toml` and the `clipcat` entry in `src-tauri/Cargo.lock`
   (`tauri.conf.json` uses the Cargo version), then update `CHANGELOG.md`.
2. After committing and pushing, open Actions → **release** → *Run workflow*, enable `publish`,
   and provide English release notes following the format of previous releases.
   This creates a `v<version>` release with installers, signatures, and `latest.json`.

Scheduled nightly publication is currently disabled in the `release` workflow.
Existing `nightly` prereleases are not stable releases and are ignored by the updater.

The updater verifies packages with a minisign key. The public key is in `tauri.conf.json`;
the private key and its password are stored in the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. If the private key is lost, existing installations
can no longer receive updates.

These package signatures are separate from Windows Authenticode signing. See the
[Code signing policy](CODE_SIGNING.md) for the current release configuration and its limits.

## Development

The UI uses React + Tailwind CSS (Vite), with source files in `ui/`; translations live in
`ui/locales/` and are also loaded by Rust.

```sh
npm install
npx tauri dev    # Vite dev server + application
npx tauri build  # installer package
```

## Verification

```sh
npm ci
npm test
npm run build
# Windows: generate the configured resources for native tests as well.
powershell -NoProfile -ExecutionPolicy Bypass -File bundle-obs.ps1
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/bundle.test.ps1
node tests/recording-crash.mjs
```

`npm run preview:ui` starts a separate browser test UI at `127.0.0.1:5174`.
It uses the real React components with simulated native responses; it does not start recording,
run an installer, or overwrite the application's saved settings.

For reproductions of the original audit findings, fixes, and test limitations, see
[audit-verification.md](docs/audit-verification.md).

For repository descriptions, topics, search checks, and maintainer guidance, see
[Discoverability](docs/DISCOVERABILITY.md).
