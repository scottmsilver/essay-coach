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

# --- Dependency map: which source files affect which functions ---
# If a shared file changes, all functions that import it (transitively) get deployed.
declare -A FILE_TO_FUNCTIONS=(
  ["src/submitEssay.ts"]="submitEssay"
  ["src/resubmitDraft.ts"]="resubmitDraft"
  ["src/analyzeTransitions.ts"]="analyzeTransitions"
  ["src/analyzeGrammar.ts"]="analyzeGrammar"
  ["src/analyzePromptAdherence.ts"]="analyzePromptAdherence"
  ["src/deleteAccount.ts"]="deleteAccount"
  ["src/devSignIn.ts"]="devSignIn"
  ["src/shareEssays.ts"]="shareEssays"
  ["src/unshareEssays.ts"]="unshareEssays"
  ["src/removeSharedWithMe.ts"]="removeSharedWithMe"
  ["src/evaluateEssay.ts"]="evaluateEssay"
  ["src/prompt.ts"]="submitEssay resubmitDraft onDraftCreated"
  ["src/gemini.ts"]="submitEssay resubmitDraft onDraftCreated"
  ["src/streamGemini.ts"]="submitEssay resubmitDraft analyzeTransitions analyzeGrammar analyzePromptAdherence evaluateEssay onDraftCreated"
  ["src/transitions.ts"]="analyzeTransitions onDraftCreated"
  ["src/sentenceSplitter.ts"]="analyzeTransitions onDraftCreated"
  ["src/grammar.ts"]="analyzeGrammar onDraftCreated"
  ["src/promptAdherence.ts"]="analyzePromptAdherence onDraftCreated"
  ["src/duplication.ts"]="analyzeDuplication onDraftCreated"
  ["src/analyzeDuplication.ts"]="analyzeDuplication"
  ["src/resolveEssayOwner.ts"]="resubmitDraft analyzeTransitions analyzeGrammar analyzePromptAdherence"
  ["src/allowlist.ts"]="submitEssay resubmitDraft analyzeTransitions analyzeGrammar analyzePromptAdherence shareEssays unshareEssays removeSharedWithMe suggestTitle"
  ["src/validation.ts"]="submitEssay resubmitDraft"
  ["src/onDraftCreated.ts"]="onDraftCreated"
  ["src/suggestTitle.ts"]="suggestTitle"
  # index.ts changes affect all functions (new exports, etc.)
  ["src/index.ts"]="__ALL__"
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
  DEPLOY_TARGETS="$ALL_FUNCTIONS"
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
    DEPLOY_TARGETS="$ALL_FUNCTIONS"
  else
    # Map changed files to affected functions
    DEPLOY_SET=""
    while IFS= read -r file; do
      # Strip "functions/" prefix if present (from repo root)
      file="${file#functions/}"
      mapped="${FILE_TO_FUNCTIONS[$file]:-}"
      if [[ "$mapped" == "__ALL__" ]]; then
        DEPLOY_SET="$ALL_FUNCTIONS"
        break
      elif [[ -n "$mapped" ]]; then
        DEPLOY_SET="$DEPLOY_SET $mapped"
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
