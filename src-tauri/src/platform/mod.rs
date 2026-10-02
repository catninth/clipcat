//! Platform layer: everything that depends on the operating system (display, foreground window,
//! key state, file manager, trash, autostart, directories, notification window).
//! Each platform exposes the same functions; other modules access the system only through these.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
pub use self::linux::*;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(not(any(windows, target_os = "linux")))]
compile_error!("ClipCat currently supports only Windows and Linux.");

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Monitor {
    /// Display identifier used by the recording engine (device path on Windows, RandR monitor index on X11)
    pub device_id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

/// An empty or disconnected selection follows the primary display, or the first available one.
pub fn selected_monitor(device_id: &str) -> Option<Monitor> {
    select_monitor(monitors(), device_id)
}

pub fn primary_monitor() -> Option<Monitor> {
    selected_monitor("")
}

fn select_monitor(monitors: Vec<Monitor>, device_id: &str) -> Option<Monitor> {
    let selected = monitors
        .iter()
        .position(|monitor| !device_id.is_empty() && monitor.device_id.eq_ignore_ascii_case(device_id))
        .or_else(|| monitors.iter().position(|monitor| monitor.primary))
        .unwrap_or(0);
    monitors.into_iter().nth(selected)
}

pub struct WindowInfo {
    pub title: String,
    #[cfg(windows)]
    pub class: String,
    /// Executable filename (including the extension on Windows)
    pub exe: String,
    pub fullscreen: bool,
}

#[cfg(test)]
mod tests {
    use super::{select_monitor, Monitor};

    fn displays() -> Vec<Monitor> {
        vec![
            Monitor { device_id: "secondary".into(), name: "Secondary".into(), width: 1920, height: 1080, primary: false },
            Monitor { device_id: "primary".into(), name: "Primary".into(), width: 2560, height: 1440, primary: true },
        ]
    }

    #[test]
    fn explicit_selection_uses_its_dimensions_even_when_not_primary() {
        let monitor = select_monitor(displays(), "SECONDARY").unwrap();
        assert_eq!(monitor.device_id, "secondary");
        assert_eq!((monitor.width, monitor.height), (1920, 1080));
    }

    #[test]
    fn automatic_and_disconnected_selection_follow_primary() {
        for selection in ["", "disconnected"] {
            let monitor = select_monitor(displays(), selection).unwrap();
            assert_eq!(monitor.device_id, "primary");
            assert_eq!((monitor.width, monitor.height), (2560, 1440));
        }
    }

    #[test]
    fn missing_primary_falls_back_to_first_available_display() {
        let mut monitors = displays();
        monitors[1].primary = false;
        assert_eq!(select_monitor(monitors, "disconnected").unwrap().device_id, "secondary");
        assert!(select_monitor(Vec::new(), "").is_none());
    }
}
