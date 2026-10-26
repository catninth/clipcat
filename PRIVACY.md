# ClipCat privacy notice

Last updated: 2026-10-26.

This notice describes the desktop application's current source configuration.
ClipCat records and manages clips on your computer. It has no ClipCat account,
license-activation service, analytics service, automatic crash-report upload, or
built-in clip upload service. It does make automatic network requests for updates.

## Recording and local information

Depending on your capture settings, ClipCat processes a selected monitor or game,
desktop audio, and microphone audio. Monitor capture can include other applications,
notifications, and anything else visible on that display. Microphone capture can be
off, push-to-talk, or always on. New installations start with the microphone and
replay buffer off; saved replay state is restored on later launches.

ClipCat reads foreground application details, including executable names and window
titles, to select capture targets and name or group recordings. It reads monitor
and audio-device information for device selection. Global shortcut and push-to-talk
handling observes configured key/button states; optional AFK detection uses time
since the last input event. It does not create a typed-text history.

The application saves recording preferences, device identifiers, folder paths,
shortcut bindings, language, replay state, and the last saved clip path in
`settings.json`. The gallery reads video paths, names, modification times and sizes,
and generates JPEG thumbnails and duration metadata in the local webview's IndexedDB
database named `clipcat`. No recordings, thumbnails, settings or diagnostic logs are
sent to the project by these features.

Capture and crash logs can contain local paths, capture-device and engine diagnostics,
configured shortcuts, and error messages. Logs stay on the computer unless you
choose to share them, for example in a public GitHub issue. Review them before sharing.

## Storage and retention

| Data | Default location and retention |
| --- | --- |
| Saved clips and manual recordings | `ClipCat` inside your system Videos folder, or the output folder selected in Settings. Kept until you delete or move them; ClipCat does not automatically delete completed clips to reclaim space. |
| Replay buffer | RAM by default. Disk mode writes MKV segments into separate `clipcat-buffer-*` session folders inside the configured Buffer folder. The default Buffer folder is `buffer` under the runtime-state directory below. |
| Windows settings | `settings.json` beside the installed ClipCat executable. |
| Windows runtime state and logs | `%LOCALAPPDATA%\ClipCat`. |
| Linux settings | `$XDG_CONFIG_HOME/clipcat/settings.json`, or `~/.config/clipcat/settings.json` when the XDG variable is unset or not absolute. |
| Linux runtime state and logs | `$XDG_STATE_HOME/clipcat`, or `~/.local/state/clipcat` when the XDG variable is unset or not absolute. |
| Gallery thumbnails | The platform-managed webview application-data profile. Entries for clips no longer in the gallery are pruned when the clip list refreshes. |

The disk replay buffer removes expired segments during capture and attempts cleanup
when a session ends. Segment boundaries, an in-progress save, or failed deletion can
keep data longer than the selected replay duration. A crash can leave session folders
behind; old sessions are not automatically swept from a user-selected folder. After
fully exiting ClipCat, you can inspect and delete those leftover session folders.
RAM buffering does not create replay segment files, but the operating system may
manage memory through paging or crash dumps.

`clipcat.log`, `crash.log`, and the optional diagnostic `selftest.log` rotate at
5 MiB per active file, retaining one previous file for each. Rotation is size-based,
not time-based; logs can remain until replaced or deleted. Manual diagnostic runs can
also write a report and test recording in the output folder supplied to that run.

ClipCat does not add encryption to these files. Folder permissions, disk encryption,
backups, and synchronization are controlled by your system. Choosing a network drive
or a folder synchronized by software such as OneDrive may copy data off the computer,
including when your system Videos folder has been redirected there.

## Network requests and third parties

- **Update checks:** about 20 seconds after startup, then every six hours while
  ClipCat is running, the current source requests the public `latest.json` asset at
  `https://github.com/catninth/clipcat/releases/latest/download/latest.json`, following
  redirects to GitHub's asset delivery hosts. This check does not use the GitHub
  REST API. The published **v0.8.1** release instead requests release metadata from
  `api.github.com`; the public-manifest change is unreleased as of this notice's date.
  **Check for updates** makes an additional request. The application does not
  configure a GitHub account or token for these
  requests. GitHub receives normal request information such as your IP address,
  requested URL and HTTP headers; the metadata client's User-Agent identifies
  `catninth-updater` and its version. Version comparison happens locally.
- **Installing an update:** only when you choose **Install and restart**, ClipCat
  fetches the selected release's `latest.json` and package from GitHub and its asset
  delivery hosts. The manifest identifies platform-specific downloads. These requests
  do not include your clips, microphone audio, local folder contents or log files.
- **Project links and support:** the repository and license buttons open GitHub in
  your system browser. Browser cookies and any information you post there are handled
  by GitHub under its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **Platform services:** the Windows installer can download Microsoft's WebView2
  bootstrapper if the required runtime is missing. WebView2, operating-system
  components, and Linux package managers have their own network and update behavior;
  see [Microsoft's privacy statement](https://privacy.microsoft.com/en-us/privacystatement)
  and your distribution's documentation. OBS and FFmpeg are used locally for capture
  and media processing; ClipCat does not configure streaming or cloud upload outputs.

## Your controls and deletion

Use the replay switch, tray controls, or configured shortcut to stop replay capture.
Manual recording is independent and must be stopped separately. Microphone mode,
capture mode, monitor, output folder, buffer mode, **Start at sign-in**, and **Capture
recovery** are configurable in Settings. Capture recovery can restart capture after
an error. Closing the main window hides it; it does not exit the application. Use
**Exit** in the tray menu to stop the application and its automatic update checks.
There is currently no in-app switch to disable those checks while keeping ClipCat
running; declining an update prevents installation, not the periodic metadata request.

Deleting a clip in the gallery asks Windows to move it to the Recycle Bin, or uses
the desktop trash service on Linux. Emptying that location is a separate action.
You can also manage saved clips directly through the file manager. Deleted files
may remain in system backups, synchronized folders, or other copies you created.

Exit ClipCat before manually removing settings, logs, leftover buffers, or webview
application data. The Windows uninstaller's **Delete application data** option removes
`settings.json` and `%LOCALAPPDATA%\ClipCat` through ClipCat's uninstall hook. It does
not remove completed clips or custom buffers stored outside that directory. Files
you choose to store inside `%LOCALAPPDATA%\ClipCat`, including completed clips, are
removed with that directory. Linux configuration, state, custom folders, and webview
data may remain after package
removal and need separate cleanup. Check the locations above and any custom paths
you selected; deleting preferences resets them on the next launch.

Questions about this notice can be raised through the
[project issue tracker](https://github.com/catninth/clipcat/issues). Issues are public;
do not include private recordings or unreviewed logs.
