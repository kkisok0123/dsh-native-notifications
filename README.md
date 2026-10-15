# DSH Native Notifications

A small Host + Web Client plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) that sends native Linux desktop notifications when an agent finishes responding or needs your attention.

Unlike an in-page popup or browser notification, alerts are delivered through the operating system using `notify-send`. No browser notification permission is required, and notifications can work with the DSH tab unfocused or closed, as long as the DSH host is still running.

## Features

- **Response finished:** normal-priority notification after a successful top-level `turn/end`.
- **Needs your input:** critical-priority notification containing the agent's structured question.
- **Approval needed:** critical-priority notification for an approval request.
- **Quiet while using DSH:** all three alerts are suppressed when any DSH tab is visible and focused. Switching tabs/apps or closing the page restores alerts. Suppressed alerts are not queued for later.
- Handles multiple tabs and expires stale foreground reports after 15 seconds if a page crashes or loses connectivity.
- Does not treat cancelled, interrupted, blocked, or failed turns as successful completions.
- Suppresses completion notifications from subagent sessions.
- Does not replay old notifications when opening conversation history.
- Uses argument-based process execution, not a shell, and escapes notification markup.
- No npm dependencies, build step, or modifications to DSH core.

## Requirements

- A DSH host with Cordis bundle support and the `session/event`, `user-questions/request`, and `approval/request` events.
- Linux with a freedesktop-compatible notification daemon. Tested with GNOME.
- `notify-send` on the DSH host's PATH. On Ubuntu/Debian it is provided by `libnotify-bin`:

  ```sh
  sudo apt install libnotify-bin
  ```

- DSH must run in the desktop user's session with access to its session D-Bus.

Notifications appear on the computer running the **DSH host**, not necessarily the computer viewing its Web UI. Windows and macOS are not supported by this version.

## Installation

Clone the repository somewhere persistent:

```sh
git clone https://github.com/kkisok0123/dsh-native-notifications.git
```

In DSH, ask the agent to install the cloned folder as a bundle. The plugin-manager tool call is:

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/dsh-native-notifications"
}
```

Refresh the DSH page once after installation/update to load the focus detector. Without the Client half loaded, the Host continues sending notifications as before.

The bundle is named `@local/dsh-native-notifications`; its plugin row is `local-native-notifications`. Installation enables it in the current profile and persists across restarts. You can disable or remove the bundle through DSH's plugin manager.

## Behavior and limitations

- “Response finished” means a successful agent turn ended, not that every item in a larger project or goal is complete.
- Questions written only as ordinary chat text are not separately detected; structured questions trigger the input alert.
- GNOME and other desktop environments control presentation and notification history. Normal notifications follow Do Not Disturb settings; critical alerts may bypass them according to desktop policy.
- Notifications currently have no click-to-open conversation action.
- Question text and approval reasons can be shown by your desktop notification system, including on the lock screen if enabled. Configure desktop privacy settings accordingly.
- Notification delivery failures are logged and do not block the agent.

## Development

Requires a modern Node.js runtime with the built-in test runner. No dependency installation is necessary:

```sh
node --check index.js
node --test test.mjs
```

The test suite covers successful-turn filtering, markup escaping, bounded text, shell-free execution, sender cleanup, and pass-through behavior for question and approval hooks.
