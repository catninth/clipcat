# Changelog

## 0.7.0 – 2026-10-02

Changes since v0.6.1.

### Added

- Add **Monitor capture** and **Automatic game capture** modes, with a monitor selector and automatic fallback to the primary display when the selected monitor is unavailable.
- Add optional AFK replay pausing with 10- or 30-minute, 1-, 2-, or 3-hour presets and custom timeouts from 10 to 86400 seconds. Keyboard or mouse input resumes replay if it is enabled; manual recordings continue with video and audio unaffected, and pending replay saves finish before pausing.
- Add an AFK pause indicator to the sidebar and tray tooltip.
- Add numeric inputs for custom replay lengths (10–1200 seconds) and integer bitrates (from 5 Mbps up to the frame-rate limit), with inline validation and one-unit slider steps.
- Identify the microphone used by **System default** with a localized default label on Windows and Linux.

### Changed

- In monitor mode, name and group replay clips by the application active when saving, and manual recordings by the application active when recording stops. Known games retain their friendly names; other applications use their executable names.
- Use the selected monitor's dimensions for native-resolution capture and bitrate recommendations.
- Replace settings dropdowns with styled, keyboard-accessible menus supporting type-ahead search, disabled options, and positioning within the viewport.
- Add Hungarian and English translations for the new controls, validation messages, and status indicators.
- Run microphone enumeration on a background worker and add `pactl` dependencies to Linux `.deb` and `.rpm` packages.

### Fixed

- Prevent settings section headings from overlapping the scroll fade.
- Show the saved-recording notification after successful finalization even if subsequent audio synchronization fails.

### Compatibility

- Existing installations retain automatic game capture and their saved desktop fallback preference. New installations default to monitor capture. AFK pausing is disabled by default for both.
- Changing the capture mode or monitor clears the replay buffer and is blocked during manual recording.
- AFK detection supports Windows and Linux X11. On Wayland, AFK detection is unavailable and the screen-sharing portal controls display selection. Controller-only input does not reset the AFK timeout.

### Tests

- Add regression coverage for AFK pause/resume and manual-recording isolation, capture settings migration, monitor selection and clip naming, custom numeric values, default microphone labeling, and dropdown keyboard navigation and accessibility.

## 0.6.0 – 2026-09-26

### Updates

- Use the shared `catninth-updater` Rust library for stable GitHub release checks, patch notes, signed downloads, and installation.
- Preserve automatic checks every six hours, localized notifications, and user-triggered installation.
- Recheck recording and clip-saving activity after downloading and reserve installation under the capture operation lock.
- Stop the capture engine and release the single-instance lock before handing off to the Windows installer or restarting after installation.
- Add updater state, progress, version precedence, and capture/installation regression tests.

## 0.5.0 – 2026-09-26

### Added

- Hungarian and English US translations, with the initial selection based on the Windows display language.
- Info section at the bottom of Settings: update check, license link, and GitHub icon.

### Fixed

- Disk save timeout, segment protection, session identification, storage and RAM limits.
- Recording engine and microphone lifecycle; working fallback after hardware encoder failures.
- Settings validation and serialized saving; protection for active recordings during reconfiguration and updates.
- Fragmented MP4 for manual recordings; finalization error reporting and preservation of partial files.
- Restricted IPC/CSP/file access, verified OBS packaging, and a GLib security backport.
- Hotkey capture cancellation, paginated gallery, bounded thumbnail cache and logging.
- CI and release workflows build the embedded UI before running native tests.

### Verification

- Regression tests and audit evidence: `docs/audit-verification.md`.

## 0.4.1 – 2026-09-21

### Fixed

- Hotkeys now work while games that swallow Windows global hotkey events have focus, such as League of Legends in borderless mode.
- Prevent duplicate actions between native hotkey events and fallback key polling.
