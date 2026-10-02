//! Choose the clip folder based on the foreground window at the time of saving.

use crate::platform::WindowInfo;

pub const DESKTOP_FOLDER: &str = "Desktop";

struct Rule {
    /// Lowercase exe name
    exe: &'static str,
    /// The window title must start with this text (e.g. for Java-based games)
    title_prefix: Option<&'static str>,
    folder: &'static str,
}

/// Exe names include the extension on Windows and omit it on Linux.
const RULES: &[Rule] = &[
    Rule { exe: "league of legends.exe", title_prefix: None, folder: "League of Legends" },
    Rule { exe: "leagueclientux.exe", title_prefix: None, folder: "League of Legends" },
    Rule { exe: "javaw.exe", title_prefix: Some("Minecraft"), folder: "Minecraft" },
    Rule { exe: "java.exe", title_prefix: Some("Minecraft"), folder: "Minecraft" },
    Rule { exe: "minecraft.windows.exe", title_prefix: None, folder: "Minecraft" },
    Rule { exe: "java", title_prefix: Some("Minecraft"), folder: "Minecraft" },
];

/// Non-games: when these run fullscreen (movie, browser), save the clip in the Desktop folder;
/// otherwise the window title (e.g. a movie filename) would become the folder name.
const NON_GAMES: &[&str] = &[
    "vlc.exe", "mpv.exe", "mpc-hc.exe", "mpc-hc64.exe", "mpc-be64.exe", "potplayermini64.exe",
    "wmplayer.exe", "microsoft.media.player.exe", "video.ui.exe", "photos.exe", "chrome.exe",
    "msedge.exe", "firefox.exe", "opera.exe", "brave.exe", "explorer.exe", "applicationframehost.exe",
    "discord.exe", "spotify.exe", "code.exe", "obs64.exe", "replaytray.exe", "clipcat.exe",
    // Linux
    "vlc", "mpv", "totem", "celluloid", "haruna", "smplayer", "firefox", "firefox-bin", "chrome", "chromium",
    "brave", "opera", "vivaldi-bin", "nautilus", "dolphin", "discord", "spotify", "code", "obs", "clipcat",
];

pub fn folder_for(window: Option<WindowInfo>) -> String {
    let Some(window) = window else { return DESKTOP_FOLDER.into() };
    if !is_game(&window) {
        return DESKTOP_FOLDER.into();
    }
    let exe = window.exe.to_lowercase();
    if let Some(rule) = RULES
        .iter()
        .find(|r| r.exe == exe && r.title_prefix.is_none_or(|p| window.title.starts_with(p)))
    {
        return rule.folder.into();
    }
    let from_title = sanitize(&clean_title(&window.title));
    if !from_title.is_empty() {
        return from_title;
    }
    let from_exe = sanitize(exe.trim_end_matches(".exe"));
    if from_exe.is_empty() { DESKTOP_FOLDER.into() } else { from_exe }
}

/// Monitor clips belong to the foreground application, including ordinary desktop apps.
/// Use executable names for stable groups across changing document and browser tab titles.
pub fn application_folder_for(window: Option<WindowInfo>) -> String {
    let Some(window) = window else { return DESKTOP_FOLDER.into() };
    let exe = window.exe.to_lowercase();
    if let Some(rule) = RULES
        .iter()
        .find(|r| r.exe == exe && r.title_prefix.is_none_or(|p| window.title.starts_with(p)))
    {
        return rule.folder.into();
    }
    let name = sanitize(exe.trim_end_matches(".exe"));
    if name.is_empty() { DESKTOP_FOLDER.into() } else { name }
}

/// Use the same classification for naming clips and selecting the capture target.
pub fn is_game(window: &WindowInfo) -> bool {
    let exe = window.exe.to_lowercase();
    !exe.is_empty()
        && !NON_GAMES.contains(&exe.as_str())
        && (window.fullscreen
            || RULES.iter().any(|r| r.exe == exe && r.title_prefix.is_none_or(|p| window.title.starts_with(p))))
}

/// "Minecraft* 1.21.1 - Multiplayer" -> "Minecraft"
fn clean_title(title: &str) -> String {
    let mut name = title;
    for separator in [" - ", " | ", " – "] {
        if let Some(i) = name.find(separator) {
            name = &name[..i];
        }
    }
    let name = name.replace('*', "");
    let mut words: Vec<&str> = name.split_whitespace().collect();
    // Remove a trailing version number: "1.21.1", "v2.0"
    if words.len() > 1 {
        let last = words[words.len() - 1].trim_start_matches(['v', 'V']);
        if !last.is_empty() && last.chars().all(|c| c.is_ascii_digit() || c == '.') {
            words.pop();
        }
    }
    words.join(" ")
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control() && !r#"<>:"/\|?*"#.contains(*c))
        .collect();
    cleaned.trim().trim_end_matches(['.', ' ']).chars().take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(exe: &str, title: &str, fullscreen: bool) -> Option<WindowInfo> {
        Some(WindowInfo {
            exe: exe.into(),
            title: title.into(),
            #[cfg(windows)]
            class: String::new(),
            fullscreen,
        })
    }

    #[test]
    fn monitor_clips_group_desktop_apps_independently_of_window_title_or_fullscreen() {
        for fullscreen in [false, true] {
            for title in ["Inbox - Gmail", "Video - YouTube"] {
                assert_eq!(application_folder_for(window("CHROME.EXE", title, fullscreen)), "chrome");
            }
            assert_eq!(application_folder_for(window("editor", "project.rs - Editor", fullscreen)), "editor");
        }
        assert_eq!(application_folder_for(window("code.exe", "report.md - Visual Studio Code", false)), "code");
        assert_eq!(folder_for(window("chrome.exe", "Video", true)), DESKTOP_FOLDER);
    }

    #[test]
    fn known_games_keep_their_friendly_groups_in_monitor_mode() {
        assert_eq!(application_folder_for(window("League of Legends.exe", "", false)), "League of Legends");
        assert_eq!(application_folder_for(window("javaw.exe", "Minecraft 1.21 - Multiplayer", false)), "Minecraft");
        assert_eq!(application_folder_for(window("javaw.exe", "Unrelated application", false)), "javaw");
        assert_eq!(folder_for(window("unknown-game.exe", "Game Title", true)), "Game Title");
    }

    #[test]
    fn absent_or_unreadable_applications_fall_back_to_desktop_and_names_are_safe() {
        assert_eq!(application_folder_for(None), DESKTOP_FOLDER);
        assert_eq!(application_folder_for(window("", "Private document title", false)), DESKTOP_FOLDER);
        assert_eq!(application_folder_for(window("../\\.exe", "", false)), DESKTOP_FOLDER);
        let name = application_folder_for(window("my<>app.exe", "", false));
        assert_eq!(name, "myapp");
    }
}
