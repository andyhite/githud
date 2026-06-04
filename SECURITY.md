# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive reports. Instead, use
GitHub's [private vulnerability reporting](https://github.com/andyhite/githud/security/advisories/new)
("Report a vulnerability" under the repo's **Security** tab). Include reproduction
steps and the affected version/commit. You'll get an acknowledgement and, where
applicable, a fix and disclosure timeline.

## How githud handles secrets

githud is a local, single-user desktop app. A few properties worth knowing:

- **Both secrets live only in the main process.** Your GitHub Personal Access Token
  and your optional Anthropic API key are encrypted with the OS keychain via Electron
  `safeStorage` and stored under the app's per-user data directory. They are never
  imported by the renderer or preload, and never cross the IPC boundary back out.
- **No telemetry.** githud makes network calls only to `api.github.com`,
  `api.anthropic.com` (only when AI features are enabled), and avatar images from
  `*.githubusercontent.com`. The renderer makes no network calls at all.
- **Read-only by default.** The only write path is starting a *pending (draft)* PR
  review with inline comments; nothing is submitted or merged on your behalf.
- **Hardened window.** A strict Content-Security-Policy and external-URL allowlist
  gate navigation and `shell.openExternal` to http(s) destinations.

## Scope notes

Builds are currently **unsigned**. The app loads no remote code into its privileged
window. If you find a way to bypass the external-URL guard, exfiltrate a stored
secret, or load remote content into the app window, that's in scope — please report
it privately.
