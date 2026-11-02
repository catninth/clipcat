//! Pin microphone capture to one physical input, independently of system-default changes.

use crate::settings::Settings;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    pub id: u64,
    pub device_name: String,
    pub reason: &'static str,
}

/// Keep one modal per outage; changing error details must not reopen a dismissed warning.
#[derive(Default)]
pub struct WarningTracker {
    warning: Option<Warning>,
    device_key: String,
    generation: u64,
}

impl WarningTracker {
    pub fn warning(&self) -> Option<&Warning> {
        self.warning.as_ref()
    }

    /// Return true only when a new failure incident needs the user's attention.
    pub fn update(
        &mut self,
        device_key: &str,
        device_name: &str,
        reason: Option<&'static str>,
    ) -> bool {
        let Some(reason) = reason else {
            self.warning = None;
            self.device_key.clear();
            return false;
        };
        if let Some(warning) = self
            .warning
            .as_mut()
            .filter(|_| self.device_key == device_key)
        {
            warning.device_name = device_name.to_string();
            warning.reason = reason;
            return false;
        }
        self.generation = self.generation.saturating_add(1);
        self.device_key = device_key.to_string();
        self.warning = Some(Warning {
            id: self.generation,
            device_name: device_name.to_string(),
            reason,
        });
        true
    }
}

fn concrete_device(id: &str) -> Option<&str> {
    (!id.trim().is_empty() && id != "default" && !id.contains('\0')).then_some(id)
}

/// An explicit choice takes precedence over the physical input remembered for "default".
pub fn preferred_device(settings: &Settings) -> Option<&str> {
    concrete_device(&settings.mic_device).or_else(|| concrete_device(&settings.last_mic_device))
}

/// Remembered identity belongs to the backend; an older settings form must not overwrite it.
pub fn prepare_settings(old: &Settings, new: &mut Settings) {
    if old.mic_device == new.mic_device {
        new.last_mic_device.clone_from(&old.last_mic_device);
        new.last_mic_name.clone_from(&old.last_mic_name);
    } else {
        new.last_mic_device.clear();
        new.last_mic_name.clear();
    }
}

/// Resolve only the requested physical input. Missing inputs retain their identity for retries.
/// The system default is consulted only before a physical input has been remembered.
pub fn reconcile_selection(
    settings: &mut Settings,
    devices: &[(String, String)],
    default_id: Option<&str>,
) -> Option<String> {
    if settings.mic_mode == "off" {
        return None;
    }
    let target = preferred_device(settings).or_else(|| default_id.and_then(concrete_device))?;
    let (id, name) = devices.iter().find(|(id, _)| id == target)?;
    settings.last_mic_device.clone_from(id);
    settings.last_mic_name = name.replace('\0', "");
    Some(id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_settings() -> Settings {
        Settings {
            mic_mode: "always".into(),
            ..Settings::default()
        }
    }

    fn devices() -> Vec<(String, String)> {
        vec![
            ("headset-id".into(), "Headset".into()),
            ("webcam-id".into(), "Webcam".into()),
        ]
    }

    #[test]
    fn first_default_is_remembered_and_survives_restart_with_a_different_default() {
        let mut settings = enabled_settings();
        assert_eq!(
            reconcile_selection(&mut settings, &devices(), Some("headset-id")).as_deref(),
            Some("headset-id")
        );
        assert_eq!(settings.last_mic_name, "Headset");
        let mut restored: Settings =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(
            reconcile_selection(&mut restored, &devices(), Some("webcam-id")).as_deref(),
            Some("headset-id")
        );
        assert_eq!(restored.mic_device, "default");
    }

    #[test]
    fn disconnect_preserves_identity_and_reconnect_selects_only_that_input() {
        let mut settings = enabled_settings();
        reconcile_selection(&mut settings, &devices(), Some("headset-id"));
        let before = settings.clone();
        assert_eq!(
            reconcile_selection(&mut settings, &devices()[1..], Some("webcam-id")),
            None
        );
        assert_eq!(settings, before);
        assert_eq!(
            reconcile_selection(&mut settings, &devices(), Some("webcam-id")).as_deref(),
            Some("headset-id")
        );
    }

    #[test]
    fn identical_display_names_never_substitute_for_the_remembered_device() {
        let mut settings = Settings {
            last_mic_device: "headset-id".into(),
            last_mic_name: "Headset".into(),
            ..enabled_settings()
        };
        assert_eq!(
            reconcile_selection(
                &mut settings,
                &[("different-id".into(), "Headset".into())],
                Some("different-id")
            ),
            None
        );
        assert_eq!(settings.last_mic_device, "headset-id");
    }

    #[test]
    fn unknown_default_never_chooses_an_arbitrary_available_device() {
        for default in [
            None,
            Some("missing-id"),
            Some("default"),
            Some(""),
            Some("bad\0id"),
        ] {
            let mut settings = enabled_settings();
            assert_eq!(
                reconcile_selection(&mut settings, &devices(), default),
                None
            );
            assert!(settings.last_mic_device.is_empty());
        }
    }

    #[test]
    fn off_mode_keeps_memory_and_never_selects_an_input() {
        let mut settings = Settings {
            last_mic_device: "headset-id".into(),
            last_mic_name: "Headset".into(),
            ..Settings::default()
        };
        let before = settings.clone();
        assert_eq!(
            reconcile_selection(&mut settings, &devices(), Some("webcam-id")),
            None
        );
        assert_eq!(settings, before);
    }

    #[test]
    fn explicit_selection_wins_even_when_missing_and_clears_the_old_label() {
        let old = Settings {
            last_mic_device: "headset-id".into(),
            last_mic_name: "Headset".into(),
            ..enabled_settings()
        };
        let mut new = Settings {
            mic_device: "missing-id".into(),
            ..old.clone()
        };
        prepare_settings(&old, &mut new);
        assert!(new.last_mic_device.is_empty());
        assert!(new.last_mic_name.is_empty());
        assert_eq!(preferred_device(&new), Some("missing-id"));
        assert_eq!(
            reconcile_selection(&mut new, &devices(), Some("headset-id")),
            None
        );

        new.mic_device = "webcam-id".into();
        assert_eq!(
            reconcile_selection(&mut new, &devices(), Some("headset-id")).as_deref(),
            Some("webcam-id")
        );
        assert_eq!(new.last_mic_name, "Webcam");
    }

    #[test]
    fn stale_forms_cannot_overwrite_backend_identity() {
        let old = Settings {
            last_mic_device: "headset-id".into(),
            last_mic_name: "Headset".into(),
            ..enabled_settings()
        };
        let mut stale = enabled_settings();
        prepare_settings(&old, &mut stale);
        assert_eq!(stale.last_mic_device, "headset-id");
        assert_eq!(stale.last_mic_name, "Headset");
    }

    #[test]
    fn selecting_default_after_an_explicit_input_resolves_the_new_default() {
        let old = Settings {
            mic_device: "headset-id".into(),
            last_mic_device: "headset-id".into(),
            last_mic_name: "Headset".into(),
            ..enabled_settings()
        };
        let mut new = Settings {
            mic_device: "default".into(),
            ..old.clone()
        };
        prepare_settings(&old, &mut new);
        assert_eq!(
            reconcile_selection(&mut new, &devices(), Some("webcam-id")).as_deref(),
            Some("webcam-id")
        );
    }

    #[test]
    fn warning_details_can_change_without_reopening_the_same_outage() {
        let mut tracker = WarningTracker::default();
        assert!(tracker.warning().is_none());
        assert!(tracker.update("headset-id", "Headset", Some("missing")));
        let first_id = tracker.warning().unwrap().id;
        assert!(!tracker.update("headset-id", "Headset", Some("missing")));
        assert!(!tracker.update("headset-id", "USB headset", Some("unavailable")));
        let warning = tracker.warning().unwrap();
        assert_eq!(warning.id, first_id);
        assert_eq!(warning.device_name, "USB headset");
        assert_eq!(warning.reason, "unavailable");
        assert!(!tracker.update("headset-id", "USB headset", Some("missing")));
        assert_eq!(tracker.warning().unwrap().id, first_id);
    }

    #[test]
    fn recovery_rearms_the_warning_and_a_different_missing_device_starts_a_new_incident() {
        let mut tracker = WarningTracker::default();
        assert!(tracker.update("headset-id", "Headset", Some("missing")));
        let first_id = tracker.warning().unwrap().id;
        assert!(!tracker.update("headset-id", "Headset", None));
        assert!(tracker.warning().is_none());
        assert!(!tracker.update("headset-id", "Headset", None));
        assert!(tracker.update("headset-id", "Headset", Some("missing")));
        let second_id = tracker.warning().unwrap().id;
        assert!(second_id > first_id);
        assert!(tracker.update("webcam-id", "Webcam", Some("missing")));
        assert!(tracker.warning().unwrap().id > second_id);
    }
}
