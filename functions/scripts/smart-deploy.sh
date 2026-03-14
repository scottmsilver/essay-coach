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

# --- Dependency map: which source files affect which functions ---
# If a shared file changes, all functions that import it (transitively) get deployed.
declare -A FILE_TO_FUNCTIONS=(
  ["src/submitEssay.ts"]="submitEssay"
  ["src/resubmitDraft.ts"]="resubmitDraft"
  ["src/deleteAccount.ts"]="deleteAccount"
  ["src/prompt.ts"]="submitEssay resubmitDraft"
  ["src/gemini.ts"]="submitEssay resubmitDraft"
  ["src/allowlist.ts"]="submitEssay resubmitDraft"
  ["src/validation.ts"]="submitEssay resubmitDraft"
  ["src/index.ts"]="submitEssay resubmitDraft deleteAccount"
)

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
  DEPLOY_TARGETS="submitEssay resubmitDraft deleteAccount"
else
  # Get changed files since last deploy
  CHANGED_FILES=$(git diff --name-only "$LAST_SHA" -- . 2>/dev/null || echo "")

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
    DEPLOY_TARGETS="submitEssay resubmitDraft deleteAccount"
  else
    # Map changed files to affected functions
    DEPLOY_SET=""
    while IFS= read -r file; do
      # Strip "functions/" prefix if present (from repo root)
      file="${file#functions/}"
      if [[ -n "${FILE_TO_FUNCTIONS[$file]:-}" ]]; then
        DEPLOY_SET="$DEPLOY_SET ${FILE_TO_FUNCTIONS[$file]}"
      fi
    done <<< "$CHANGED_FILES"

    # Deduplicate
    DEPLOY_TARGETS=$(echo "$DEPLOY_SET" | tr ' ' '\n' | sort -u | tr '\n' ' ' | xargs)
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
