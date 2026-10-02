/// Missing platform data must neither stop capture nor mistake an unavailable sensor for input.
pub fn should_pause(timeout_seconds: u32, idle_seconds: Option<u64>, paused: bool) -> bool {
    timeout_seconds != 0 && idle_seconds.map_or(paused, |idle| idle >= u64::from(timeout_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_policy_never_pauses_and_releases_an_existing_pause() {
        assert!(!should_pause(0, Some(u64::MAX), false));
        assert!(!should_pause(0, Some(u64::MAX), true));
        assert!(!should_pause(0, None, true));
    }

    #[test]
    fn pause_starts_at_the_exact_timeout_and_input_resumes_capture() {
        assert!(!should_pause(137, Some(136), false));
        assert!(should_pause(137, Some(137), false));
        assert!(should_pause(137, Some(999), true));
        assert!(!should_pause(137, Some(0), true));
        assert!(!should_pause(600, Some(137), true));
    }

    #[test]
    fn unknown_idle_time_preserves_current_state() {
        assert!(!should_pause(60, None, false));
        assert!(should_pause(60, None, true));
    }
}
