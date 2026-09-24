#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
PROJECT="liubai-ledger-cloud-v2-preview"
BASE_URL="https://liubai-ledger-cloud-v2-preview.vercel.app"
ENV_FILE="$ROOT/.env.cloud-v2.local"
MIGRATION="$ROOT/cloud/supabase/migrations/202609230001_cloud_v2.sql"

if [[ ! -f "$FRONTEND/.vercel/project.json" ]]; then
  echo "[guard] Link only the isolated Vercel project"
  npx --yes vercel project inspect "$PROJECT" >/dev/null
  npx --yes vercel link --yes --project "$PROJECT" --cwd "$FRONTEND" >/dev/null
fi

LINKED_PROJECT="$(python3 - "$FRONTEND/.vercel/project.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["projectName"])
PY
)"

if [[ "$LINKED_PROJECT" != "$PROJECT" ]]; then
  echo "ERROR: refusing to deploy linked project: $LINKED_PROJECT" >&2
  exit 2
fi

echo "[1/7] Pull isolated Vercel Production env"
npx --yes vercel env pull "$ENV_FILE" \
  --environment=production \
  --yes \
  --cwd "$FRONTEND" >/dev/null

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  SUPABASE_URL
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SECRET_KEY
  POSTGRES_URL_NON_POOLING
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is missing. Supabase Marketplace is not connected yet." >&2
    exit 3
  fi
done

echo "[2/7] Apply Cloud v2 schema to isolated Supabase"
psql "$POSTGRES_URL_NON_POOLING" \
  -v ON_ERROR_STOP=1 \
  -f "$MIGRATION" >/dev/null

echo "[3/7] Build Cloud Shortcut for isolated Vercel URL"
cd "$ROOT"
LEDGER_CLOUD_API_BASE="$BASE_URL" python3 scripts/build_cloud_shortcut.py

validator="${SHORTCUT_VALIDATOR:-}"
if [[ -z "$validator" ]]; then
  candidates=(
    "$HOME/AI-Workspace/.tmp/shortcuts-playground-20260923/claude/skills/shortcuts-playground/scripts/validate_shortcut.py"
    "$HOME/AI-Workspace/.tmp/shortcuts-playground-20260923/codex/skills/shortcuts-playground/scripts/validate_shortcut.py"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      validator="$candidate"
      break
    fi
  done
fi

if [[ -z "$validator" || ! -f "$validator" ]]; then
  echo "ERROR: set SHORTCUT_VALIDATOR to shortcuts-playground validate_shortcut.py" >&2
  exit 4
fi

python3 "$validator" \
  --target-macos 27 \
  --target-platform ios \
  shortcuts/src/Liubai-Cloud.plist

echo "[4/7] Apple-sign Shortcut"
mkdir -p "$FRONTEND/public/shortcuts"
shortcuts sign --mode anyone \
  --input "$ROOT/shortcuts/source/Liubai-Cloud.unsigned.shortcut" \
  --output "$FRONTEND/public/shortcuts/Liubai-Cloud.shortcut"

echo "[5/7] Run static/build gates"
python3 "$ROOT/scripts/check_cloud_v2.py"
(
  cd "$FRONTEND"
  npm run test:cloud-api
  for file in api/_shared/cloud.js api/v2/pair/start.js api/v2/pair/exchange.js api/v2/wallet/ingest.js api/v2/devices.js; do
    node --check "$file"
  done
  npm run typecheck
  npm run lint
  VITE_PUBLIC_DOCS=1 npm run build
)

echo "[6/7] Deploy only the isolated Vercel project"
npx --yes vercel deploy --prod --yes --cwd "$FRONTEND"

echo "[7/7] Smoke the fixed preview alias"
python3 - "$BASE_URL" <<'PY'
import json, sys, urllib.error, urllib.request
base = sys.argv[1].rstrip("/")

def call(path, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, res.read(256).decode(errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(256).decode(errors="replace")

checks = [
    ("/", "GET", None, 200),
    ("/connect", "GET", None, 200),
    ("/api/v2/pair/exchange", "POST", {}, 400),
    ("/api/wallet", "POST", {}, 404),
]
for path, method, body, expected in checks:
    status, _ = call(path, method, body)
    if status != expected:
        raise SystemExit(f"FAIL {path}: expected {expected}, got {status}")
    print(f"PASS {path}: {status}")
PY

echo "PASS Cloud v2 preview release: $BASE_URL"
