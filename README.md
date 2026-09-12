# Chat Status Lights

Colored status dots next to sidebar chat titles. See which chats need attention without opening them one by one.

## What the colors mean

| Dot | Meaning |
| --- | --- |
| Blue (pulsing) | The agent is running in that chat |
| Red | The chat's last turn ended with an error |
| Yellow | An action in that chat is waiting for your approval (requires the Human Approval Gate plugin) |
| Green | The chat finished work you have not opened yet; clears when you select the chat |

While a chat is running, blue wins. Otherwise: red > yellow > green.

## Install

1. Copy this folder into `usr/plugins/chat_status_lights` in your Agent Zero installation (or install via the Plugin Hub once published).
2. Reload the WebUI.

No settings needed. Yellow dots appear automatically if the Human Approval Gate plugin is installed and enabled; without it, everything else still works.

## How it works

A small WebUI extension watches the sidebar chat store and injects one dot per chat row (top-level chats and their children). Error detection goes through a tiny API endpoint included here: it scans each chat's log for error entries that come after its most recent response entry, so the red flag clears itself once the chat runs and finishes normally. Finished-unread state is tracked per browser in sessionStorage. No data leaves your machine.

## Limitations (MVP)

- Red is based on log-type heuristics (error entries after the last response), not deep failure analysis
- Covers the main chats sidebar and project sidebar lists
- Dot colors are fixed (no theme settings yet)

## License

MIT
