# Record a real ClipCat replay demonstration

This procedure documents an actual **enable buffer → capture → save → play** run of
ClipCat by Cat Ninth. It is a recording checklist, not a completed test report.
The [existing gallery](gallery/README.md) uses sample clips and simulated capture
state; those images do not establish live recording compatibility.

## Prepare a reproducible run

1. Use the native desktop application from a named release or an identified source
   commit. The browser preview does not run capture.
2. Record the environment and settings in the report below. Start with H.264,
   1080p, 60 FPS, and a short replay length such as 30 seconds, or use lower settings
   appropriate for the test machine. State any changes.
3. Choose a writable save folder and a capture target you can share publicly, such
   as a game scene with no private chat or a purpose-made desktop animation.
   Select **Monitor capture** for a repeatable first test. On Wayland, grant the
   system screen-sharing portal access to that display.
4. Set desktop audio and microphone deliberately. If testing microphone capture,
   speak a recognizable test phrase and record the selected device and mode.
5. If producing a walkthrough video, use an independent camera or screen recorder
   to show ClipCat's controls and the playback result. Record that extra recorder in
   the environment details; it can affect capture load. Do not present this as a
   performance benchmark.

## Demonstrate the complete workflow

1. Show the replay switch off, then turn it on. Wait for **Replay buffer running**.
2. Show the actual **Encoder** status. Let capture run for longer than the selected
   replay length while the test scene visibly changes.
3. Create an obvious event, such as opening an in-game menu or advancing the test
   animation. Press **Alt+F10** shortly afterward. If the shortcut fails, record
   that failure separately before trying **Save now**; a button save does not
   establish that the shortcut worked.
4. Wait for completion, open the new clip in **Gallery**, and play it through the
   event. Check the intended display, duration, desktop audio, and microphone audio
   where enabled. Show the final file in its save folder.
5. Record any black frames, missing audio, unexpected CPU fallback, wrong target,
   truncated duration, or save error. Keep the result for the original run even if
   a later settings change fixes it.
6. Stop replay and any independent manual recording when finished. Use **Exit** in
   the tray menu to close ClipCat; closing the main window only hides it.

Run RAM and disk mode separately if claiming both work. A Windows result does not
verify Linux; X11 and Wayland also need separate results. Game-hook capture requires
a separate Windows run if the demonstration used monitor capture.

## Report template

Copy this template into a test report and replace every placeholder. Publish only
recordings and machine details you intend to share.

```text
Date:
ClipCat release/tag or full source commit:
Package filename / build method:
OS and version; Linux distribution and X11/Wayland desktop, if applicable:
CPU / GPU / graphics driver / installed RAM:
OBS version (system OBS on Linux; bundled version or package on Windows):
FFmpeg version:
Independent walkthrough recorder, if used:
Capture mode and display / game:
Selected codec / actual encoder shown:
Resolution / FPS / bitrate:
Replay length / RAM or disk mode / available memory or disk space:
Desktop audio / microphone device and mode:
Save trigger (shortcut or button):
Observed duration / video / desktop audio / microphone results:
Result (pass, partial, or fail) and limitations:
Public demo video and saved sample clip links, if provided:
```

Link a completed report from the [compatibility guide](COMPATIBILITY.md) only after
checking the saved file. Describe failures and the tested version alongside successes.
Do not turn one machine's successful run into a claim that every GPU or OS works.
