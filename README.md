# githud

A personal, single-user desktop dashboard for the GitHub information an engineer
cares about day to day:

- **Needs my review** — open PRs where I'm a requested reviewer (author, reviewers, checks, age).
- **My open PRs** — PRs I authored, with review status (approvals / changes requested / mergeable) and check status.
- **Activity** — an always-visible feed of everything relevant to me, sourced from the GitHub Notifications API (mentions, comments, review requests, CI, …), enriched with the latest comment body and filterable by author / bots.
- **Native notifications** on new review requests, new activity, and my PRs newly failing checks or getting changes requested.

It's read-only (rows link out to github.com), polls every 30s, and stores your
token encrypted in the OS keychain. Built for one user (me) on one machine.

## Prerequisites

- **Node.js** 18+ and **pnpm** (`npm i -g pnpm` if you don't have it).
- A **GitHub Personal Access Token** (classic) with scopes: `repo`, `read:org`, `notifications`.
  Or a fine-grained token with read access to pull requests, checks, and notifications.

## Setup

```bash
pnpm install
```

> **Electron-binary gotcha:** Electron downloads a ~277 MB platform binary via a
> post-install script. If `pnpm install` finishes without downloading it (it can
> reuse an already-"built" copy from the pnpm store, or skip the script in some
> environments), `pnpm run dev` fails with `Error: Electron uninstall`. Fix it with:
>
> ```bash
> pnpm rebuild electron        # or: node node_modules/electron/install.js
> ```
>
> You only hit this on a fresh/primed install. `node_modules` is gitignored, so
> the binary is never committed.

## Run

```bash
pnpm run dev      # launch with hot-reload (normal use)
```

On first launch you'll see a token screen — paste your PAT, click **Save token**.
The token is validated against GitHub, encrypted with Electron `safeStorage`, and
stored locally; you only do this once. The dashboard then auto-refreshes every 30s
(manual refresh and window-focus also trigger a poll).

## Other commands

| Command | What it does |
|---|---|
| `pnpm run dev` | Run with hot-reload |
| `pnpm run build` | Compile main/preload/renderer into `out/` |
| `pnpm start` | Run the compiled build (`electron-vite preview`) |
| `pnpm run package` | Produce an unsigned `.app` under `dist/` (`electron-builder --mac --dir`) |
| `pnpm test` | Run the test suite (Vitest) |
| `pnpm run typecheck` | `tsc --noEmit` |

The packaged app is unsigned, so the first open needs **right-click → Open** (or
*System Settings → Privacy & Security → Open Anyway*) to clear Gatekeeper.

## Settings & data

The **⚙** button opens settings: desktop-notifications toggle, stale threshold
(days), "hide bot authors," and an excluded-authors denylist (comma-separated).

Local data lives in Electron's userData dir
(`~/Library/Application Support/githud/`):

- `token.enc` — your encrypted PAT (delete to be re-prompted)
- `settings.json` — your settings
- `snapshot.json` — last dashboard snapshot (for instant cold-start)

## Design docs

- Spec: [`docs/superpowers/specs/2026-06-02-githud-dashboard-design.md`](docs/superpowers/specs/2026-06-02-githud-dashboard-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-06-02-githud-dashboard.md`](docs/superpowers/plans/2026-06-02-githud-dashboard.md)
