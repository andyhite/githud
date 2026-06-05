# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source release scaffolding: `LICENSE` (MIT), `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, and CI + release
  GitHub Actions workflows.
- `electron-builder` configuration for macOS, Windows, and Linux targets.
- Settings → Connections "Maintenance" controls: **Clear AI cache** and a
  two-click **Reset credentials** (removes the stored GitHub token and Anthropic
  key from this machine and returns to the setup screen).

### Changed
- Neutralized the default AI review prompt (removed the original author's personal
  voice profile and all company/teammate references); it's now a generic
  collaborative-reviewer seed, still fully editable in Settings.
- Genericized defaults: the "Other PRs" panel label filter is now empty (opt-in) and
  quiet hours default to 22:00–08:00.
- Rewrote the README for a public audience and corrected stale descriptions.

## [0.1.0]

Initial version. Local, single-user, read-only GitHub dashboard (one narrow write
path: starting a draft PR review you submit yourself — see below):

- Needs-review, My-open-PRs, and opt-in Other-PRs panels.
- Derived activity feed (diffed from PR state), trend strip, and native
  notifications with quiet hours.
- Adaptive polling that backs off as the GitHub GraphQL budget runs low.
- Optional, opt-in AI layer (Anthropic): per-PR triage, "catch me up" digest, and a
  draft-review flow (pending review with inline comments only).
- Tokens and keys encrypted locally via Electron `safeStorage`.

### Known limitations
- Builds are unsigned (Gatekeeper/SmartScreen prompts on first open).
- Single GitHub account, github.com only.
- Credentials are machine-locked and not portable across installs.

[Unreleased]: https://github.com/andyhite/githud/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/andyhite/githud/releases/tag/v0.1.0
