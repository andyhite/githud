# githud

A local, single-user desktop dashboard for the GitHub pull requests and activity
you care about day to day. It runs on your machine, talks only to github.com (and,
optionally, the Anthropic API), and is read-only by design — rows link out to
github.com rather than acting on your behalf.

> **Status:** early (v0.1.0), unsigned builds. Single-account, github.com only.
> Built to be useful for one person on one machine, not a hosted service.

## Features

- **Needs review** — open PRs where you're an individually requested reviewer, with
  author, reviewers, checks, age, and (optionally) an AI triage verdict.
- **Other PRs** *(opt-in)* — a review-ready overview scoped to the orgs / teams /
  labels you configure. Hidden until you add a source in Settings.
- **My open PRs** — PRs you authored, with review status (approvals / changes
  requested / mergeable) and check status.
- **Activity feed** — an always-visible feed of what changed (new reviews, comments,
  CI transitions, lifecycle changes). It is **derived** by diffing each poll's PR
  state against the previous poll — not pulled from a notifications endpoint — and is
  filterable by author / bots.
- **Trend strip** — small charts for review-queue depth, open WIP, and merges, built
  up from daily samples as the app runs.
- **Native notifications** for the event kinds you opt into (new review requests,
  changes requested, newly failing checks, …), with quiet hours.
- **Adaptive polling** — polls roughly every 30s by default and automatically backs
  off as your GitHub GraphQL budget runs low, keeping a configurable reserve.
- **Optional AI layer** (off until you add an Anthropic key) — per-PR triage, a
  "catch me up" digest, and a first-pass **draft review**. See [AI features](#ai-features).

## Prerequisites

- **Node.js** 18+ and **pnpm** (`npm i -g pnpm` if you don't have it).
- A **GitHub Personal Access Token**:
  - Classic token with scopes `repo`, `read:org`, `notifications`, **or**
  - A fine-grained token with read access to pull requests and checks.
- *(Optional)* An **Anthropic API key**, only if you want the AI features.

## Install & run

```bash
pnpm install
pnpm run dev      # launch with hot-reload
```

> **Electron-binary gotcha:** Electron downloads a large platform binary via a
> post-install script. If `pnpm install` finishes without it (it can reuse an
> already-"built" copy from the pnpm store, or skip the script in some
> environments), `pnpm run dev` fails with `Error: Electron uninstall`. Fix it with:
>
> ```bash
> pnpm rebuild electron        # or: node node_modules/electron/install.js
> ```
>
> `node_modules` is gitignored, so the binary is never committed.

On first launch you'll see a token screen — paste your PAT and click **Save token**.
The token is validated against GitHub, encrypted with Electron `safeStorage`, and
stored locally; you only do this once. The dashboard then auto-refreshes (manual
refresh and window-focus also trigger a poll).

## Building a distributable

```bash
pnpm run build        # compile main/preload/renderer into out/
pnpm run package      # produce installers for the current platform into dist/
pnpm run package:dir  # unpacked app dir (faster, for local testing)
```

`electron-builder` is configured for macOS (`dmg`/`zip`), Windows (`nsis`), and
Linux (`AppImage`). Builds are **unsigned**, so:

- **macOS** — first open needs **right-click → Open** (or *System Settings → Privacy
  & Security → Open Anyway*) to clear Gatekeeper.
- **Windows** — SmartScreen may warn; choose *More info → Run anyway*.

CI builds and attaches release artifacts on tagged releases — see
[`.github/workflows`](.github/workflows).

## Configuration

The **⚙** button opens Settings, organized into tabs:

| Tab | What's there |
|---|---|
| **General** | Refresh interval, API budget reserve, stale threshold, launch at login |
| **Notifications** | Per-kind notification toggles, quiet hours |
| **Filters & Views** | Excluded authors, the "Other PRs" source (orgs / teams / labels), and saved per-panel views |
| **Review** | The editable AI review system prompt (only relevant with an Anthropic key) |
| **Connections** | Update your GitHub token; add/replace your Anthropic key |
| **Appearance** | Light / dark theme |

## AI features

The AI layer is **dormant until you add an Anthropic API key** in *Settings →
Connections*. Everything runs in the main process; the renderer never sees the key.
AI is **on-demand only** (never on the poll loop):

- **Triage** — a per-PR verdict (size + AI risk read), cached on disk.
- **Digest** — a "catch me up" summary, plus a brief on-focus delta digest.
- **Draft review** — generates inline review comments for a PR. This is the app's
  **only write path**: it creates a **pending (draft) review with inline line
  comments only** — no summary body and no verdict — which you finish and submit
  yourself on github.com. The AI's overall assessment/recommendation stays in the
  app and is never posted.

Results are cached locally and keyed by PR + head commit, so they auto-invalidate
on new commits.

## Local data

githud stores everything locally, in Electron's per-user data directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/githud/` |
| Windows | `%APPDATA%\githud\` |
| Linux | `~/.config/githud/` |

It contains your encrypted token (`token.enc`) and Anthropic key, your
`settings.json`, the last dashboard snapshot (for instant cold-start), the derived
activity/event store, history samples, and the AI result cache. Secrets are
encrypted with the OS keychain via Electron `safeStorage` and are **not portable** —
you'll re-authenticate on a new machine or after a reinstall. Delete `token.enc`
to be re-prompted.

## Privacy

githud talks to `api.github.com`, `api.anthropic.com` (only if you enable AI), and
loads avatar images from `*.githubusercontent.com`. It has no telemetry and makes no
other network calls. See [`SECURITY.md`](SECURITY.md) for how to report issues.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, the
test/typecheck/build commands, and conventions. [`CLAUDE.md`](CLAUDE.md) is the
detailed architecture reference (data flow, the main↔renderer boundary, and the
module map).

## License

[MIT](LICENSE)
