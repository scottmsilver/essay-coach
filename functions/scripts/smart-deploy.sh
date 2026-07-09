#!/usr/bin/env bash
# Smart deploy: only deploys Firebase functions whose source files have changed
# since the last successful deploy.
#
# Usage:
#   ./scripts/smart-deploy.sh          # deploy only changed functions
#   ./scripts/smart-deploy.sh --all    # force deploy all functions
#   ./scripts/smart-deploy.sh --dry    # show what would deploy without deploying

set -euo pipefail

PROJECT="essay-grader-83737x"
MARKER_FILE=".last-deploy-sha"
FUNCTIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$FUNCTIONS_DIR"

# --- Flags ---
FORCE_ALL=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --all) FORCE_ALL=true ;;
    --dry) DRY_RUN=true ;;
  esac
done

# --- Auto-discover all exported functions from index.ts ---
# Parses "export { foo } from './bar'" lines to build the canonical function list.
ALL_FUNCTIONS=$(grep -oP "export\s*\{\s*\K[^}]+" src/index.ts | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sort -u | tr '\n' ' ' | xargs)

# --- Dependency resolution ---
# scripts/changed-functions.ts derives the real import graph with esbuild
# (metafile) and maps changed files to affected functions — ../shared included.
# No hand-maintained map: files are picked up because they're imported.
# (A hand map here once silently skipped src/gdocResolver.ts — 2026-07-08.)

# Files that trigger a full deploy if changed
FULL_DEPLOY_FILES=("package.json" "package-lock.json" "tsconfig.json" "firebase.json")

# --- Determine what changed ---
LAST_SHA=""
if [[ -f "$MARKER_FILE" ]]; then
  LAST_SHA=$(cat "$MARKER_FILE")
fi

if $FORCE_ALL || [[ -z "$LAST_SHA" ]]; then
  if [[ -z "$LAST_SHA" ]] && ! $FORCE_ALL; then
    echo "No previous deploy marker found. Deploying all functions."
  fi
  DEPLOY_TARGETS="$ALL_FUNCTIONS"
elif ! git -C .. cat-file -e "$LAST_SHA^{commit}" 2>/dev/null; then
  # Marker points at a commit that no longer exists (rebase/gc). A failed diff
  # must NOT read as "no changes" — deploy everything instead.
  echo "⚠️  Deploy marker $LAST_SHA is not a valid commit — deploying all functions."
  DEPLOY_TARGETS="$ALL_FUNCTIONS"
else
  # Get changed files since last deploy — from the REPO ROOT so ../shared
  # changes are seen too (paths come back repo-root-relative). Root
  # firebase.json is included: it configures functions deployment.
  CHANGED_FILES=$(git -C .. diff --name-only "$LAST_SHA" -- functions shared firebase.json)

  if [[ -z "$CHANGED_FILES" ]]; then
    echo "No changes since last deploy ($LAST_SHA). Nothing to do."
    exit 0
  fi

  echo "Changed files since last deploy:"
  echo "$CHANGED_FILES" | sed 's/^/  /'
  echo ""

  # Check if any full-deploy trigger files changed
  NEED_FULL=false
  for trigger in "${FULL_DEPLOY_FILES[@]}"; do
    if echo "$CHANGED_FILES" | grep -q "^$trigger$\|functions/$trigger$"; then
      echo "⚡ $trigger changed — deploying all functions."
      NEED_FULL=true
      break
    fi
  done

  if $NEED_FULL; then
    DEPLOY_TARGETS="$ALL_FUNCTIONS"
  else
    # Map changed files to affected functions via the real import graph.
    # On resolver failure, fall back to deploying everything (never skip silently).
    if DEPLOY_TARGETS=$(echo "$CHANGED_FILES" | npx tsx scripts/changed-functions.ts); then
      :
    else
      echo "⚠️  changed-functions.ts failed — deploying ALL functions to be safe."
      DEPLOY_TARGETS="$ALL_FUNCTIONS"
    fi
  fi
fi

if [[ -z "$DEPLOY_TARGETS" ]]; then
  echo "No function-affecting files changed. Nothing to deploy."
  exit 0
fi

# Build the --only flag
ONLY_FLAG=$(echo "$DEPLOY_TARGETS" | tr ' ' '\n' | sed 's/^/functions:/' | paste -sd, -)

echo "🚀 Deploying: $DEPLOY_TARGETS"
echo "   firebase deploy --only $ONLY_FLAG --project $PROJECT"
echo ""

if $DRY_RUN; then
  echo "(dry run — skipping actual deploy)"
  exit 0
fi

# Build first
echo "Building..."
npm run build

# Deploy
firebase deploy --only "$ONLY_FLAG" --project "$PROJECT"

# Record the current SHA as the last successful deploy
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
if [[ -n "$CURRENT_SHA" ]]; then
  echo "$CURRENT_SHA" > "$MARKER_FILE"
  echo ""
  echo "✅ Deploy marker updated to $CURRENT_SHA"
else
  echo "⚠️  Not a git repo or no commits — skipping deploy marker."
fi
