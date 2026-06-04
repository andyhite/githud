# Contributing to githud

Thanks for your interest in improving githud. It's a local, single-user, read-only
GitHub dashboard — small and focused on purpose. This guide covers how to get set up
and what to keep in mind.

## Getting started

```bash
pnpm install
pnpm run dev      # launch with hot-reload
```

> If `pnpm run dev` fails with `Error: Electron uninstall` on a fresh install, run
> `pnpm rebuild electron` (the platform binary download sometimes gets skipped). See
> the README for details.

Use **pnpm**, not npm — the lockfile is pnpm's and the repo pins a `packageManager`
version.

## Before you open a PR

Run all three and make sure they pass:

```bash
pnpm run typecheck   # tsc --noEmit
pnpm test            # Vitest
pnpm run build       # bundle all three Electron processes
```

CI runs the same three on every pull request.

## Project conventions

These are the load-bearing ones; `CLAUDE.md` has the full architecture reference.

- **The main ↔ renderer boundary carries exactly one type**, `DashboardSnapshot`
  (`src/shared/types.ts`). All GitHub/Anthropic I/O and both secrets live in the
  main process; the renderer never touches the network or any token.
- **Test pure logic, not glue.** Normalizers, filters, diffing, store helpers, and
  the pure renderer helpers are unit-tested with Vitest; Electron/SDK glue is
  validated by manual smoke testing. New pure logic should follow TDD.
- **Keep files small and single-purpose.** Pure functions take loosely-typed
  GraphQL/REST input and return typed shapes.
- **Renderer styling** is Tailwind v4 + shadcn/ui with semantic tokens — no
  hand-rolled CSS or hard-coded colors. See the gotchas in `CLAUDE.md`.
- **No personal or company-specific data.** Don't hard-code usernames, orgs, teams,
  labels, or schedules — expose them as configuration with neutral defaults.

## Scope

githud is deliberately read-only (with one narrow exception: starting a *draft* PR
review) and single-account, github.com only. Proposals that fit that scope are the
most likely to be accepted; see "Scope discipline (YAGNI)" in `CLAUDE.md` before
proposing larger features.

## Commit messages

Conventional-commit style is used in history (`feat:`, `fix:`, `chore:`,
`refactor:`, `docs:`) — please follow it.

## Reporting bugs / security issues

Use the issue templates for bugs and feature requests. For anything
security-sensitive, see [`SECURITY.md`](SECURITY.md) instead of opening a public
issue.
