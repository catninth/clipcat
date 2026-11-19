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

    /// The input of the current outage, or empty when there is none.
    pub fn device_key(&self) -> &str {
        &self.device_key
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
        new.last_mic_fingerprint.clone_from(&old.last_mic_fingerprint);
    } else {
        new.last_mic_device.clear();
        new.last_mic_name.clear();
        new.last_mic_fingerprint.clear();
    }
    new.dismissed_mic_warning.clone_from(&old.dismissed_mic_warning);
}

/// Hardware identity of an endpoint: the parent device's hardware ID without its port-dependent
/// instance suffix, plus the endpoint's own name to tell a device's inputs apart.
/// "{1}.USB\VID_3142&PID_A010&MI_00\7&1065BD9&0&0000" + "Mikrofon" -> "USB\VID_3142&PID_A010&MI_00|Mikrofon"
pub fn fingerprint(parent: &str, endpoint_name: &str) -> String {
    let parent = parent.trim().replace('\0', "");
    let parent = match parent.split_once("}.") {
        Some((prefix, rest)) if prefix.starts_with('{') => rest,
        _ => parent.as_str(),
    };
    let hardware = parent.rsplit_once('\\').map_or(parent, |(hardware, _)| hardware);
    if hardware.is_empty() {
        return String::new();
    }
    format!("{}|{}", hardware.to_ascii_uppercase(), endpoint_name.trim().replace('\0', ""))
}

fn endpoint_fingerprint<'a>(endpoints: &'a [(String, String)], id: &str) -> Option<&'a str> {
    endpoints
        .iter()
        .find(|(endpoint, _)| endpoint.eq_ignore_ascii_case(id))
        .map(|(_, fingerprint)| fingerprint.as_str())
}

/// A remembered input whose endpoint Windows deleted (it is absent in every state) can never come back
/// under its old ID. Follow it only to the single available input with the same hardware fingerprint;
/// zero or several matches stay a warning instead of a guess.
fn rebind_target<'a>(
    settings: &Settings,
    target: &str,
    devices: &'a [(String, String)],
    endpoints: &[(String, String)],
) -> Option<&'a (String, String)> {
    let fingerprint = settings.last_mic_fingerprint.as_str();
    if fingerprint.is_empty()
        || !settings.last_mic_device.eq_ignore_ascii_case(target)
        || endpoint_fingerprint(endpoints, target).is_some()
    {
        return None;
    }
    let mut matches = devices
        .iter()
        .filter(|(id, _)| endpoint_fingerprint(endpoints, id) == Some(fingerprint));
    let found = matches.next()?;
    matches.next().is_none().then_some(found)
}

/// Resolve only the requested physical input. Missing inputs retain their identity for retries.
/// The system default is consulted only before a physical input has been remembered.
/// `endpoints` lists every endpoint the system still knows (see `platform::mic_endpoints`).
pub fn reconcile_selection(
    settings: &mut Settings,
    devices: &[(String, String)],
    default_id: Option<&str>,
    endpoints: Option<&[(String, String)]>,
) -> Option<String> {
    if settings.mic_mode == "off" {
        return None;
    }
    let target = preferred_device(settings)
        .or_else(|| default_id.and_then(concrete_device))?
        .to_owned();
    let (id, name) = match devices.iter().find(|(id, _)| *id == target) {
        Some(found) => found,
        None => {
            let found = rebind_target(settings, &target, devices, endpoints?)?;
            if settings.mic_device == target {
                settings.mic_device.clone_from(&found.0);
            }
            found
        }
    };
    match endpoints.and_then(|endpoints| endpoint_fingerprint(endpoints, id)) {
        Some(fingerprint) if !fingerprint.is_empty() => settings.last_mic_fingerprint = fingerprint.to_owned(),
        _ if settings.last_mic_device != *id => settings.last_mic_fingerprint.clear(),
        _ => (),
    }
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

    fn reconcile(settings: &mut Settings, devices: &[(String, String)], default_id: Option<&str>) -> Option<String> {
        reconcile_selection(settings, devices, default_id, None)
    }

    const FIFINE: &str = r"USB\VID_3142&PID_A010&MI_00|Mikrofon";

    /// A fifine input remembered under an endpoint ID that Windows has since replaced.
    fn remembered_fifine(mic_device: &str) -> Settings {
        Settings {
            mic_device: mic_device.into(),
            last_mic_device: "old-id".into(),
            last_mic_name: "Mikrofon (fifine Microphone)".into(),
            last_mic_fingerprint: FIFINE.into(),
            ..enabled_settings()
        }
    }

    fn after_port_change() -> (Vec<(String, String)>, Vec<(String, String)>) {
        let devices = vec![
            ("new-id".into(), "Mikrofon (fifine Microphone)".into()),
            ("webcam-id".into(), "Webcam".into()),
        ];
        let endpoints = vec![
            ("NEW-ID".into(), FIFINE.into()),
            ("webcam-id".into(), r"USB\VID_1111&PID_2222&MI_02|Mikrofon".into()),
        ];
        (devices, endpoints)
    }

    #[test]
    fn fingerprint_drops_the_flow_prefix_and_port_dependent_instance() {
        assert_eq!(fingerprint(r"{1}.USB\VID_3142&PID_A010&MI_00\7&1065BD9&0&0000", " Mikrofon "), FIFINE);
        assert_eq!(fingerprint(r"usb\vid_3142&pid_a010&mi_00\8&2&0", "Mikrofon"), FIFINE);
        assert_eq!(fingerprint("", "Mikrofon"), "");
    }

    #[test]
    fn deleted_endpoint_follows_the_single_input_with_the_same_hardware() {
        let (devices, endpoints) = after_port_change();
        let mut settings = remembered_fifine("default");
        assert_eq!(
            reconcile_selection(&mut settings, &devices, Some("webcam-id"), Some(&endpoints)).as_deref(),
            Some("new-id")
        );
        assert_eq!(settings.mic_device, "default");
        assert_eq!(settings.last_mic_device, "new-id");
        assert_eq!(settings.last_mic_fingerprint, FIFINE);
    }

    #[test]
    fn explicit_selection_follows_its_deleted_endpoint_too() {
        let (devices, endpoints) = after_port_change();
        let mut settings = remembered_fifine("old-id");
        assert_eq!(
            reconcile_selection(&mut settings, &devices, None, Some(&endpoints)).as_deref(),
            Some("new-id")
        );
        assert_eq!(settings.mic_device, "new-id");
    }

    #[test]
    fn unplugged_endpoint_is_waited_for_instead_of_replaced() {
        let (devices, mut endpoints) = after_port_change();
        endpoints.push(("old-id".into(), FIFINE.into()));
        let mut settings = remembered_fifine("default");
        let before = settings.clone();
        assert_eq!(reconcile_selection(&mut settings, &devices, None, Some(&endpoints)), None);
        assert_eq!(settings, before);
    }

    #[test]
    fn ambiguous_unknown_or_unfingerprinted_inputs_are_never_guessed() {
        let (mut devices, mut endpoints) = after_port_change();
        devices.push(("twin-id".into(), "Mikrofon (fifine Microphone)".into()));
        endpoints.push(("twin-id".into(), FIFINE.into()));
        let mut settings = remembered_fifine("default");
        assert_eq!(reconcile_selection(&mut settings, &devices, None, Some(&endpoints)), None);

        let (devices, endpoints) = after_port_change();
        assert_eq!(reconcile_selection(&mut settings, &devices, None, None), None);
        settings.last_mic_fingerprint.clear();
        assert_eq!(reconcile_selection(&mut settings, &devices, None, Some(&endpoints)), None);
        assert_eq!(settings.last_mic_device, "old-id");
    }

    #[test]
    fn resolving_an_input_records_its_fingerprint() {
        let (devices, endpoints) = after_port_change();
        let mut settings = enabled_settings();
        assert_eq!(
            reconcile_selection(&mut settings, &devices, Some("new-id"), Some(&endpoints)).as_deref(),
            Some("new-id")
        );
        assert_eq!(settings.last_mic_fingerprint, FIFINE);
    }

    #[test]
    fn first_default_is_remembered_and_survives_restart_with_a_different_default() {
        let mut settings = enabled_settings();
        assert_eq!(
            reconcile(&mut settings, &devices(), Some("headset-id")).as_deref(),
            Some("headset-id")
        );
        assert_eq!(settings.last_mic_name, "Headset");
        let mut restored: Settings =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(
            reconcile(&mut restored, &devices(), Some("webcam-id")).as_deref(),
            Some("headset-id")
        );
        assert_eq!(restored.mic_device, "default");
    }

    #[test]
    fn disconnect_preserves_identity_and_reconnect_selects_only_that_input() {
        let mut settings = enabled_settings();
        reconcile(&mut settings, &devices(), Some("headset-id"));
        let before = settings.clone();
        assert_eq!(
            reconcile(&mut settings, &devices()[1..], Some("webcam-id")),
            None
        );
        assert_eq!(settings, before);
        assert_eq!(
            reconcile(&mut settings, &devices(), Some("webcam-id")).as_deref(),
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
            reconcile(
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
                reconcile(&mut settings, &devices(), default),
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
            reconcile(&mut settings, &devices(), Some("webcam-id")),
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
            reconcile(&mut new, &devices(), Some("headset-id")),
            None
        );

        new.mic_device = "webcam-id".into();
        assert_eq!(
            reconcile(&mut new, &devices(), Some("headset-id")).as_deref(),
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
            reconcile(&mut new, &devices(), Some("webcam-id")).as_deref(),
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
