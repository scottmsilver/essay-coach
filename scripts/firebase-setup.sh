#!/usr/bin/env bash
set -euo pipefail

# Firebase Setup Script for EssayCoach
# Uses firebase CLI + gcloud CLI to automate as much as possible.
# For steps that require manual action, prompts the user and verifies.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FUNCTIONS_DIR="$ROOT/functions"
ENV_FILE="$ROOT/.env.local"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

pass()  { echo -e "  ${GREEN}[OK]${NC} $1"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $1"; }
info()  { echo -e "  ${YELLOW}[INFO]${NC} $1"; }
header(){ echo -e "\n${BOLD}=== Step $1: $2 ===${NC}"; }
wait_for_user() { echo -e "\n  Press ${BOLD}Enter${NC} when done..."; read -r; }

HAS_GCLOUD=false

# ─── Step 1: Check CLIs ─────────────────────────────────────────────────────
header 1 "Check CLIs"

# Firebase CLI
if command -v firebase &>/dev/null; then
  VERSION=$(firebase --version 2>/dev/null || echo "unknown")
  pass "firebase CLI installed (v$VERSION)"
elif npx firebase-tools --version &>/dev/null; then
  pass "firebase CLI available via npx"
else
  info "Installing firebase-tools..."
  npm install -g firebase-tools
  if command -v firebase &>/dev/null; then
    pass "firebase CLI installed"
  else
    fail "Could not install firebase-tools. Install manually: npm i -g firebase-tools"
    exit 1
  fi
fi

# Alias firebase to npx if not globally installed
FIREBASE="firebase"
if ! command -v firebase &>/dev/null; then
  FIREBASE="npx firebase-tools"
fi

# gcloud CLI (optional but very useful)
if command -v gcloud &>/dev/null; then
  GCLOUD_VERSION=$(gcloud --version 2>/dev/null | head -1 || echo "unknown")
  pass "gcloud CLI installed ($GCLOUD_VERSION)"
  HAS_GCLOUD=true
else
  info "gcloud CLI not found (optional but recommended)"
  info "Install from: https://cloud.google.com/sdk/docs/install"
  info "Without gcloud, some steps may require manual action in the browser."
fi

# ─── Step 2: Firebase login ──────────────────────────────────────────────────
header 2 "Firebase Authentication"

if $FIREBASE login --interactive 2>/dev/null | grep -q "Already logged in"; then
  pass "Already logged in to Firebase"
else
  info "Opening browser for Firebase login..."
  $FIREBASE login --interactive
  if [ $? -eq 0 ]; then
    pass "Logged in to Firebase"
  else
    fail "Firebase login failed"
    exit 1
  fi
fi

# ─── Step 3: Create or select project ────────────────────────────────────────
header 3 "Firebase Project"

echo ""
info "Loading your Firebase projects..."

# Fetch project IDs and display names into arrays
PROJECT_IDS=()
PROJECT_NAMES=()
while IFS='|' read -r pid pname; do
  PROJECT_IDS+=("$pid")
  PROJECT_NAMES+=("$pname")
done < <($FIREBASE projects:list --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
if isinstance(data, dict) and 'result' in data:
    data = data['result']
for p in data:
    pid = p.get('projectId', '')
    name = p.get('displayName', pid)
    print(f'{pid}|{name}')
" 2>/dev/null || true)

if [ ${#PROJECT_IDS[@]} -eq 0 ]; then
  fail "Could not fetch project list"
  echo ""
  read -rp "  Enter your project ID manually: " PROJECT_ID
else
  # Add "Create new project" option
  PROJECT_IDS+=("__NEW__")
  PROJECT_NAMES+=("Create a new project")

  # Arrow-key picker using tput
  pick_project() {
    local selected=0
    local count=${#PROJECT_IDS[@]}

    tput civis 2>/dev/null >/dev/tty || true

    echo "" >/dev/tty
    echo -e "  ${BOLD}Use arrow keys to select, Enter to confirm:${NC}" >/dev/tty
    echo "" >/dev/tty
    for i in "${!PROJECT_IDS[@]}"; do
      if [ "$i" -eq "$selected" ]; then
        echo -e "  ${GREEN}> ${PROJECT_NAMES[$i]}${NC}  ${YELLOW}(${PROJECT_IDS[$i]})${NC}" >/dev/tty
      else
        echo -e "    ${PROJECT_NAMES[$i]}  (${PROJECT_IDS[$i]})" >/dev/tty
      fi
    done

    while true; do
      IFS= read -rsn1 key </dev/tty
      if [[ "$key" == $'\x1b' ]]; then
        read -rsn2 arrow </dev/tty
        case "$arrow" in
          '[A') ((selected > 0)) && ((selected--)) || true ;;
          '[B') ((selected < count - 1)) && ((selected++)) || true ;;
        esac
      elif [[ "$key" == "" ]]; then
        break
      fi

      printf '\033[%dA' "$count" >/dev/tty
      for i in "${!PROJECT_IDS[@]}"; do
        printf '\033[K' >/dev/tty
        if [ "$i" -eq "$selected" ]; then
          echo -e "  ${GREEN}> ${PROJECT_NAMES[$i]}${NC}  ${YELLOW}(${PROJECT_IDS[$i]})${NC}" >/dev/tty
        else
          echo -e "    ${PROJECT_NAMES[$i]}  (${PROJECT_IDS[$i]})" >/dev/tty
        fi
      done
    done

    tput cnorm 2>/dev/null >/dev/tty || true
    echo "${PROJECT_IDS[$selected]}"
  }

  PICKED=$(pick_project)

  if [[ "$PICKED" == "__NEW__" ]]; then
    echo ""
    read -rp "  Enter a new project ID (e.g. essay-grader-app): " PROJECT_ID
    echo ""
    info "Creating project '$PROJECT_ID'..."
    $FIREBASE projects:create "$PROJECT_ID" --display-name "EssayCoach" 2>&1 || true
    echo ""
    info "Waiting a moment for the project to be available..."
    sleep 5
  else
    PROJECT_ID="$PICKED"
  fi
fi

# Verify the project exists
echo ""
if $FIREBASE projects:list --json 2>/dev/null | grep -qF "$PROJECT_ID"; then
  pass "Project '$PROJECT_ID' found"
else
  fail "Could not verify project '$PROJECT_ID'"
  echo "  Double-check the project ID and try again if needed."
  echo "  You can also check: https://console.firebase.google.com/"
  echo ""
  read -rp "  Continue anyway with '$PROJECT_ID'? (y/n): " CONTINUE_ANYWAY
  if [[ "$CONTINUE_ANYWAY" != "y" && "$CONTINUE_ANYWAY" != "Y" ]]; then
    exit 1
  fi
fi

echo ""
pass "Using project: $PROJECT_ID"

# Update .firebaserc
cat > "$ROOT/.firebaserc" <<EOF
{
  "projects": {
    "default": "$PROJECT_ID"
  }
}
EOF
pass "Updated .firebaserc with project ID"

# Set gcloud project if available
if $HAS_GCLOUD; then
  gcloud config set project "$PROJECT_ID" 2>/dev/null || true
fi

# ─── Step 4: Blaze plan ──────────────────────────────────────────────────────
header 4 "Blaze (Pay-as-you-go) Plan"

echo ""
echo "  Cloud Functions, secrets, and some APIs require the Blaze plan."
echo "  It's free for low usage — you only pay if you exceed the generous free tier."
echo ""

# Check if billing is already linked
BILLING_LINKED=false
if $HAS_GCLOUD; then
  CURRENT_BILLING=$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingAccountName)" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BILLING" ]; then
    BILLING_LINKED=true
  fi
fi

if $BILLING_LINKED; then
  pass "Billing already linked ($CURRENT_BILLING)"
elif $HAS_GCLOUD; then
  info "No billing account linked. Checking available billing accounts..."
  echo ""

  BILLING_IDS=()
  BILLING_NAMES=()
  while IFS='|' read -r bid bname; do
    BILLING_IDS+=("$bid")
    BILLING_NAMES+=("$bname")
  done < <(gcloud billing accounts list --format="value(name,displayName)" 2>/dev/null | while IFS=$'\t' read -r bid bname; do echo "$bid|$bname"; done || true)

  if [ ${#BILLING_IDS[@]} -eq 0 ]; then
    echo "  No billing accounts found. Please set one up at:"
    echo "  https://console.cloud.google.com/billing"
    echo ""
    echo "  Then re-run this script."
    wait_for_user
  elif [ ${#BILLING_IDS[@]} -eq 1 ]; then
    echo "  Found billing account: ${BILLING_NAMES[0]} (${BILLING_IDS[0]})"
    read -rp "  Link this billing account to the project? (y/n): " LINK_BILLING
    if [[ "$LINK_BILLING" == "y" || "$LINK_BILLING" == "Y" ]]; then
      gcloud billing projects link "$PROJECT_ID" --billing-account="${BILLING_IDS[0]}" 2>&1
      pass "Billing account linked"
    else
      info "Skipping. You can link billing manually later."
    fi
  else
    # Multiple billing accounts — let user pick
    pick_billing() {
      local selected=0
      local count=${#BILLING_IDS[@]}

      tput civis 2>/dev/null >/dev/tty || true
      echo "" >/dev/tty
      echo -e "  ${BOLD}Select a billing account:${NC}" >/dev/tty
      echo "" >/dev/tty
      for i in "${!BILLING_IDS[@]}"; do
        if [ "$i" -eq "$selected" ]; then
          echo -e "  ${GREEN}> ${BILLING_NAMES[$i]}${NC}  ${YELLOW}(${BILLING_IDS[$i]})${NC}" >/dev/tty
        else
          echo -e "    ${BILLING_NAMES[$i]}  (${BILLING_IDS[$i]})" >/dev/tty
        fi
      done

      while true; do
        IFS= read -rsn1 key </dev/tty
        if [[ "$key" == $'\x1b' ]]; then
          read -rsn2 arrow </dev/tty
          case "$arrow" in
            '[A') ((selected > 0)) && ((selected--)) || true ;;
            '[B') ((selected < count - 1)) && ((selected++)) || true ;;
          esac
        elif [[ "$key" == "" ]]; then
          break
        fi
        printf '\033[%dA' "$count" >/dev/tty
        for i in "${!BILLING_IDS[@]}"; do
          printf '\033[K' >/dev/tty
          if [ "$i" -eq "$selected" ]; then
            echo -e "  ${GREEN}> ${BILLING_NAMES[$i]}${NC}  ${YELLOW}(${BILLING_IDS[$i]})${NC}" >/dev/tty
          else
            echo -e "    ${BILLING_NAMES[$i]}  (${BILLING_IDS[$i]})" >/dev/tty
          fi
        done
      done
      tput cnorm 2>/dev/null >/dev/tty || true
      echo "${BILLING_IDS[$selected]}"
    }

    PICKED_BILLING=$(pick_billing)
    echo ""
    info "Linking billing account $PICKED_BILLING..."
    gcloud billing projects link "$PROJECT_ID" --billing-account="$PICKED_BILLING" 2>&1
    pass "Billing account linked"
  fi
else
  echo "  Please link a billing account (Blaze plan) at:"
  echo "  https://console.firebase.google.com/project/$PROJECT_ID/usage/details"
  echo ""
  echo "  Click 'Modify plan' → Select 'Blaze' → Confirm billing."
  echo ""
  wait_for_user
  pass "Continuing (assuming Blaze plan is active)"
fi

# ─── Step 5: Enable required APIs ────────────────────────────────────────────
header 5 "Enable Google Cloud APIs"

if $HAS_GCLOUD; then
  echo ""
  info "Enabling free-tier APIs via gcloud..."
  echo ""

  for API in \
    firestore.googleapis.com \
    identitytoolkit.googleapis.com \
    firebase.googleapis.com \
    firebaserules.googleapis.com \
    cloudfunctions.googleapis.com; do
    echo -n "  Enabling $API... "
    if gcloud services enable "$API" --project "$PROJECT_ID" 2>&1; then
      echo -e "${GREEN}done${NC}"
    else
      echo -e "${YELLOW}skipped (may already be enabled)${NC}"
    fi
  done

  echo ""
  # These APIs require billing — try once, prompt if they fail
  BILLING_APIS=(cloudbuild.googleapis.com artifactregistry.googleapis.com)
  BILLING_FAILED=()

  for API in "${BILLING_APIS[@]}"; do
    echo -n "  Enabling $API... "
    if gcloud services enable "$API" --project "$PROJECT_ID" 2>/dev/null; then
      echo -e "${GREEN}done${NC}"
    else
      echo -e "${RED}failed (requires billing)${NC}"
      BILLING_FAILED+=("$API")
    fi
  done

  if [ ${#BILLING_FAILED[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${YELLOW}Some APIs require a billing account linked to the project.${NC}"
    echo "  This can only be done in the browser:"
    echo ""
    echo "  https://console.firebase.google.com/project/$PROJECT_ID/usage/details"
    echo ""
    echo "  Click 'Modify plan' → Select 'Blaze' → Confirm billing."
    echo ""
    wait_for_user

    info "Retrying billing-required APIs..."
    echo ""
    for API in "${BILLING_FAILED[@]}"; do
      echo -n "  Enabling $API... "
      if gcloud services enable "$API" --project "$PROJECT_ID" 2>/dev/null; then
        echo -e "${GREEN}done${NC}"
      else
        echo -e "${RED}still failed — you may need to check billing${NC}"
      fi
    done
  fi

  # Grant Storage Object Viewer to the default compute service account
  # Required for Gen1 Cloud Functions (e.g. auth triggers) to build successfully
  echo ""
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null || echo "")
  if [ -n "$PROJECT_NUMBER" ]; then
    echo -n "  Granting storage access to compute service account... "
    if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
      --role="roles/storage.objectViewer" \
      --condition=None 2>/dev/null | grep -q "storage.objectViewer"; then
      echo -e "${GREEN}done${NC}"
    else
      echo -e "${YELLOW}skipped (may already be granted)${NC}"
    fi
  fi

  echo ""
  pass "API enablement complete"
else
  info "gcloud not available — enabling APIs via browser instead."
  echo ""
  echo "  Please enable these APIs for project '$PROJECT_ID':"
  echo ""
  echo "  1. Firestore:        https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=$PROJECT_ID"
  echo "  2. Identity Toolkit: https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=$PROJECT_ID"
  echo "  3. Cloud Functions:  https://console.developers.google.com/apis/api/cloudfunctions.googleapis.com/overview?project=$PROJECT_ID"
  echo ""
  wait_for_user
fi

# ─── Step 6: Enable Google sign-in ────────────────────────────────────────────
header 6 "Google Sign-In"

echo ""
echo "  Checking if Google sign-in is enabled..."

GOOGLE_ENABLED=false
if $HAS_GCLOUD; then
  GCLOUD_TOKEN=$(gcloud auth print-access-token 2>/dev/null || echo "")
  if [ -n "$GCLOUD_TOKEN" ]; then
    GOOGLE_CHECK=$(curl -s \
      -H "Authorization: Bearer $GCLOUD_TOKEN" \
      -H "x-goog-user-project: $PROJECT_ID" \
      "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/defaultSupportedIdpConfigs" 2>/dev/null || echo "")
    if echo "$GOOGLE_CHECK" | grep -q "google.com"; then
      GOOGLE_ENABLED=true
    fi
  fi
fi

if $GOOGLE_ENABLED; then
  pass "Google sign-in is already enabled"
else
  echo ""
  echo "  Google sign-in is not enabled yet. Please do this manually:"
  echo ""
  echo "  1. Go to: https://console.firebase.google.com/project/$PROJECT_ID/authentication/providers"
  echo "  2. Click 'Get started' if Authentication isn't enabled yet"
  echo "  3. Click 'Google' in the provider list"
  echo "  4. Toggle 'Enable'"
  echo "  5. Set a project support email"
  echo "  6. Click 'Save'"
  echo ""

  wait_for_user
fi

# ─── Step 7: Create Firestore database ───────────────────────────────────────
header 7 "Firestore Database"

echo ""
echo "  Checking if Firestore is already set up..."

# Deploy rules to ensure database is fully initialized (metadata-only creation is not enough)
info "Deploying Firestore rules (this also ensures the database is fully initialized)..."
$FIREBASE deploy --only firestore:rules --project "$PROJECT_ID" 2>&1 || {
  echo ""
  fail "Could not deploy Firestore rules."
  echo ""
  echo "  Please create/initialize the database manually:"
  echo "  1. Go to: https://console.firebase.google.com/project/$PROJECT_ID/firestore"
  echo "  2. Click 'Create database' if prompted"
  echo "  3. Select 'Start in production mode'"
  echo "  4. Choose a location (us-central recommended)"
  echo "  5. Click 'Enable'"
  wait_for_user
}
pass "Firestore database ready with security rules deployed"

# ─── Step 8: Register a web app ──────────────────────────────────────────────
header 8 "Web App Registration"

echo ""
echo "  Checking for existing web apps..."

WEB_APP_IDS=()
WEB_APP_NAMES=()
while IFS='|' read -r aid aname; do
  WEB_APP_IDS+=("$aid")
  WEB_APP_NAMES+=("$aname")
done < <($FIREBASE apps:list --project "$PROJECT_ID" --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
if isinstance(data, dict) and 'result' in data:
    data = data['result']
for a in data:
    if a.get('platform','').upper() == 'WEB':
        print(f'{a[\"appId\"]}|{a.get(\"displayName\", a[\"appId\"])}')
" 2>/dev/null || true)

if [ ${#WEB_APP_IDS[@]} -eq 1 ]; then
  APP_ID="${WEB_APP_IDS[0]}"
  pass "Using existing web app: ${WEB_APP_NAMES[0]} (${APP_ID})"
elif [ ${#WEB_APP_IDS[@]} -gt 1 ]; then
  WEB_APP_IDS+=("__NEW__")
  WEB_APP_NAMES+=("Create a new web app")

  pick_app() {
    local selected=0
    local count=${#WEB_APP_IDS[@]}

    tput civis 2>/dev/null >/dev/tty || true
    echo "" >/dev/tty
    echo -e "  ${BOLD}Multiple web apps found. Use arrow keys to select:${NC}" >/dev/tty
    echo "" >/dev/tty
    for i in "${!WEB_APP_IDS[@]}"; do
      if [ "$i" -eq "$selected" ]; then
        echo -e "  ${GREEN}> ${WEB_APP_NAMES[$i]}${NC}" >/dev/tty
      else
        echo -e "    ${WEB_APP_NAMES[$i]}" >/dev/tty
      fi
    done

    while true; do
      IFS= read -rsn1 key </dev/tty
      if [[ "$key" == $'\x1b' ]]; then
        read -rsn2 arrow </dev/tty
        case "$arrow" in
          '[A') ((selected > 0)) && ((selected--)) || true ;;
          '[B') ((selected < count - 1)) && ((selected++)) || true ;;
        esac
      elif [[ "$key" == "" ]]; then
        break
      fi
      printf '\033[%dA' "$count" >/dev/tty
      for i in "${!WEB_APP_IDS[@]}"; do
        printf '\033[K' >/dev/tty
        if [ "$i" -eq "$selected" ]; then
          echo -e "  ${GREEN}> ${WEB_APP_NAMES[$i]}${NC}" >/dev/tty
        else
          echo -e "    ${WEB_APP_NAMES[$i]}" >/dev/tty
        fi
      done
    done
    tput cnorm 2>/dev/null >/dev/tty || true
    echo "${WEB_APP_IDS[$selected]}"
  }

  PICKED_APP=$(pick_app)
  if [[ "$PICKED_APP" == "__NEW__" ]]; then
    info "Creating new web app 'EssayCoach'..."
    CREATE_OUTPUT=$($FIREBASE apps:create web "EssayCoach" --project "$PROJECT_ID" 2>&1)
    APP_ID=$(echo "$CREATE_OUTPUT" | grep -oP '1:\d+:web:[a-f0-9]+' || echo "")
    echo "$CREATE_OUTPUT"
  else
    APP_ID="$PICKED_APP"
  fi
else
  info "No web apps found. Creating 'EssayCoach'..."
  CREATE_OUTPUT=$($FIREBASE apps:create web "EssayCoach" --project "$PROJECT_ID" 2>&1)
  APP_ID=$(echo "$CREATE_OUTPUT" | grep -oP '1:\d+:web:[a-f0-9]+' || echo "")
  echo "$CREATE_OUTPUT"
fi

# ─── Step 9: Write .env.local ────────────────────────────────────────────────
header 9 "Web Client Config (.env.local)"

if [ -n "${APP_ID:-}" ]; then
  info "Fetching SDK config for app $APP_ID..."
  SDK_CONFIG=$($FIREBASE apps:sdkconfig web "$APP_ID" --project "$PROJECT_ID" 2>/dev/null || echo "")

  if echo "$SDK_CONFIG" | grep -q "apiKey"; then
    # Handle both JSON ("apiKey": "val") and JS (apiKey: "val") output formats
    extract() { echo "$SDK_CONFIG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null || echo "$SDK_CONFIG" | grep -oP '(?<="?'"$1"'"?\s*[:=]\s*").*?(?=")' | head -1; }
    API_KEY=$(extract apiKey)
    AUTH_DOMAIN=$(extract authDomain)
    PROJECT=$(extract projectId)
    STORAGE=$(extract storageBucket)
    MESSAGING=$(extract messagingSenderId)
    APP=$(extract appId)

    cat > "$ENV_FILE" <<EOCONFIG
VITE_FIREBASE_API_KEY=$API_KEY
VITE_FIREBASE_AUTH_DOMAIN=$AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID=$PROJECT
VITE_FIREBASE_STORAGE_BUCKET=$STORAGE
VITE_FIREBASE_MESSAGING_SENDER_ID=$MESSAGING
VITE_FIREBASE_APP_ID=$APP
EOCONFIG
    pass "Wrote config to $ENV_FILE"
  else
    info "Could not parse SDK config automatically."
    echo "  Please get your config from:"
    echo "  https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
    echo "  Scroll to 'Your apps' > Web app > SDK setup and configuration > Config"
    echo ""
    echo "  Then edit: $ENV_FILE"
    wait_for_user
  fi
else
  info "No App ID available — you'll need to fill in .env.local manually."
  echo "  Please get your web config from:"
  echo "  https://console.firebase.google.com/project/$PROJECT_ID/settings/general"
  echo ""
  echo "  Then edit: $ENV_FILE"
  wait_for_user
fi

# Verify .env.local
echo ""
if [ -f "$ENV_FILE" ]; then
  if grep -q "VITE_FIREBASE_API_KEY=." "$ENV_FILE" 2>/dev/null; then
    pass ".env.local has API key set"
  else
    fail ".env.local exists but API key is empty — please fill it in"
  fi
else
  fail ".env.local not found at $ENV_FILE"
fi

# ─── Step 10: Set Gemini API key as Firebase secret ──────────────────────────
header 10 "Gemini API Key (Firebase Secret)"

echo ""
echo "  The Cloud Functions need a Gemini API key stored as a Firebase secret."
echo "  (Requires Blaze plan — upgrade at https://console.firebase.google.com/project/$PROJECT_ID/usage/details)"
echo ""

# Check if secret already exists
SECRET_EXISTS=false
if $FIREBASE functions:secrets:access GEMINI_API_KEY --project "$PROJECT_ID" &>/dev/null; then
  SECRET_EXISTS=true
fi

if $SECRET_EXISTS; then
  pass "GEMINI_API_KEY secret already set"
else
  read -rp "  Enter your Gemini API key (or press Enter to skip): " GEMINI_KEY
  if [ -n "$GEMINI_KEY" ]; then
    echo "$GEMINI_KEY" | $FIREBASE functions:secrets:set GEMINI_API_KEY --project "$PROJECT_ID" 2>&1
    if [ $? -eq 0 ]; then
      pass "Gemini API key set"
    else
      fail "Could not set secret. Make sure the project is on the Blaze plan."
    fi
  else
    info "Skipping. Set it later with: firebase functions:secrets:set GEMINI_API_KEY --project $PROJECT_ID"
  fi
fi

# ─── Step 11: Seed the allowlist ─────────────────────────────────────────────
header 11 "Seed Allowlist"

echo ""
echo "  The allowlist controls who can use the app."
echo "  Default emails: user1@example.com, user2@example.com, user3@example.com"
echo ""
read -rp "  Seed the allowlist now? (y/n): " SEED_ALLOWLIST
if [[ "$SEED_ALLOWLIST" == "y" || "$SEED_ALLOWLIST" == "Y" ]]; then
  # Run from functions/ dir so firebase-admin resolves from functions/node_modules
  (cd "$FUNCTIONS_DIR" && GCLOUD_PROJECT="$PROJECT_ID" npx tsx scripts/seed-allowlist.ts 2>&1) || {
    info "Auto-seed failed. You can seed manually in the Firestore console:"
    echo "  https://console.firebase.google.com/project/$PROJECT_ID/firestore"
    echo "  Collection: config → Document: allowlist"
    echo "  Field 'emails' (array): [\"user1@example.com\", \"user2@example.com\", \"user3@example.com\"]"
  }
else
  info "Skipping allowlist seed. Add it manually in the Firestore console if needed."
fi

# ─── Step 12: Deploy ─────────────────────────────────────────────────────────
header 12 "Deploy"

echo ""
read -rp "  Deploy to Firebase now? (y/n): " DO_DEPLOY
if [[ "$DO_DEPLOY" == "y" || "$DO_DEPLOY" == "Y" ]]; then
  echo ""
  info "Building frontend..."
  cd "$ROOT" && npm run build

  echo ""
  info "Deploying to Firebase (hosting, functions, firestore rules)..."
  $FIREBASE deploy --project "$PROJECT_ID"

  echo ""
  HOSTING_URL=$($FIREBASE hosting:channel:list --project "$PROJECT_ID" --json 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and 'result' in data:
        for ch in data['result']:
            if ch.get('name', '').endswith('/live'):
                print(ch.get('url', ''))
                break
except: pass
" 2>/dev/null || echo "")

  if [ -z "$HOSTING_URL" ]; then
    HOSTING_URL="https://$PROJECT_ID.web.app"
  fi

  # Firebase v2 callable functions run on Cloud Run which defaults to authenticated-only.
  # Firebase Auth is enforced in the function code, so Cloud Run must allow allUsers.
  if $HAS_GCLOUD; then
    echo ""
    info "Granting public invocation access to Cloud Run services (required for Firebase callable functions)..."
    for SVC in submitessay resubmitdraft; do
      echo -n "  $SVC... "
      if gcloud run services add-iam-policy-binding "$SVC" \
        --region=us-central1 \
        --member="allUsers" \
        --role="roles/run.invoker" \
        --project="$PROJECT_ID" 2>/dev/null | grep -q "allUsers"; then
        echo -e "${GREEN}done${NC}"
      else
        echo -e "${YELLOW}skipped (may already be set or service not found)${NC}"
      fi
    done
  fi

  pass "Deployed! Your app is at: $HOSTING_URL"
else
  info "Skipping deploy. When ready, run:"
  echo "    npm run build && $FIREBASE deploy --project $PROJECT_ID"
fi

# ─── Step 13: Ensure .gitignore covers secrets ───────────────────────────────
header 13 "Gitignore Check"

GITIGNORE="$ROOT/.gitignore"

if grep -q ".env.local" "$GITIGNORE" 2>/dev/null; then
  pass ".env.local is gitignored"
else
  echo ".env.local" >> "$GITIGNORE"
  pass "Added .env.local to .gitignore"
fi

# ─── Final summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== Summary ===${NC}"
echo ""

ERRORS=0

if [ -f "$ENV_FILE" ] && grep -q "VITE_FIREBASE_API_KEY=." "$ENV_FILE"; then
  pass "Web client config (.env.local): ready"
else
  fail "Web client config (.env.local): not ready"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$ROOT/.firebaserc" ] && grep -q "$PROJECT_ID" "$ROOT/.firebaserc"; then
  pass "Firebase project: $PROJECT_ID"
else
  fail "Firebase project: not configured"
  ERRORS=$((ERRORS + 1))
fi

if grep -q ".env.local" "$GITIGNORE"; then
  pass "Secrets gitignored: yes"
else
  fail "Secrets gitignored: no"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}${BOLD}Firebase setup complete!${NC}"
  echo ""
  echo "  To start dev server:  npm run dev"
  echo "  To deploy:            npm run build && firebase deploy"
else
  echo -e "${RED}${BOLD}$ERRORS issue(s) remaining. Re-run this script after fixing them.${NC}"
fi
echo ""
