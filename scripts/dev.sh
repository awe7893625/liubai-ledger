#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Ledger dev — starting backend (8000) + frontend (5173)"
( cd "$DIR/backend"
  export DATABASE_URL="sqlite:////$DIR/backend/data/ledger.db"
  exec python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
) &
BE=$!
( cd "$DIR/frontend"
  exec npm run dev
) &
FE=$!
trap "kill $BE $FE 2>/dev/null || true" EXIT
wait
