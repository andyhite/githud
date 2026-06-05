#!/usr/bin/env bash
#
# release.sh — cut a githud release.
#
# Bumps package.json, creates a matching `vX.Y.Z` commit + annotated tag, and
# pushes. The push triggers .github/workflows/release.yml, which builds the
# per-platform artifacts and attaches them to a DRAFT GitHub Release for you to
# review and publish manually.
#
# Usage:
#   pnpm run release [patch|minor|major|<exact-version>] [--dry-run]
#
#   patch (default)   0.1.0 -> 0.1.1
#   minor             0.1.0 -> 0.2.0
#   major             0.1.0 -> 1.0.0
#   1.4.2             -> exactly 1.4.2
#   --dry-run         run all preflight checks and print the plan; touch nothing
#
# The script owns the version and the tag together so they can never drift, and
# refuses to run unless the working tree is clean, you're on the release branch,
# in sync with origin, and typecheck + tests pass.

set -euo pipefail

RELEASE_BRANCH="main"

BUMP="patch"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    patch | minor | major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg" ;;
    *)
      echo "error: unrecognized argument '$arg'" >&2
      echo "usage: pnpm run release [patch|minor|major|<exact-version>] [--dry-run]" >&2
      exit 2
      ;;
  esac
done

# Run from the repo root regardless of where the script was invoked from.
cd "$(git rev-parse --show-toplevel)"

step() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

# --- Preflight ---------------------------------------------------------------

step "Preflight"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "$RELEASE_BRANCH" ] ||
  fail "on branch '$BRANCH'; releases must be cut from '$RELEASE_BRANCH'."

[ -z "$(git status --porcelain)" ] ||
  fail "working tree is dirty; commit or stash changes before releasing."

git fetch --quiet origin "$RELEASE_BRANCH"
LOCAL="$(git rev-parse @)"
REMOTE="$(git rev-parse "origin/$RELEASE_BRANCH")"
[ "$LOCAL" = "$REMOTE" ] ||
  fail "local '$RELEASE_BRANCH' is not in sync with origin; pull/push first."

echo "  branch '$BRANCH' clean and in sync with origin."

# --- Gate: typecheck + tests -------------------------------------------------

step "Typecheck"
pnpm run typecheck

step "Tests"
pnpm test

# --- Compute the new version (no writes yet) ---------------------------------

CURRENT="$(node -p "require('./package.json').version")"

# `pnpm version --no-git-tag-version` rewrites package.json only; we create the
# commit and tag ourselves for full control. Run it in dry-run too so an invalid
# bump (e.g. a version older than current) is caught before we touch anything,
# then roll the file back.
pnpm version "$BUMP" --no-git-tag-version >/dev/null
NEW="$(node -p "require('./package.json').version")"
TAG="v$NEW"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git checkout --quiet package.json
  fail "tag '$TAG' already exists."
fi

step "Plan"
echo "  $CURRENT -> $NEW   (tag $TAG)"

if [ "$DRY_RUN" -eq 1 ]; then
  git checkout --quiet package.json
  echo
  echo "  --dry-run: package.json reverted, no commit/tag/push made."
  exit 0
fi

# --- Commit, tag, push -------------------------------------------------------

step "Committing and tagging"
git add package.json
git commit --quiet -m "chore(release): $TAG"
git tag -a "$TAG" -m "$TAG"

step "Pushing"
git push origin "$RELEASE_BRANCH" --follow-tags

REPO_URL="$(git remote get-url origin |
  sed -E 's#^git@[^:]*:#https://github.com/#; s#^https://[^/]*/#https://github.com/#; s#\.git$##')"

step "Done"
echo "  Pushed $TAG. The Release workflow is building artifacts."
echo "  Draft release: ${REPO_URL}/releases"
echo "  Actions:       ${REPO_URL}/actions/workflows/release.yml"
