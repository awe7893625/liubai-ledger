#!/usr/bin/env bash
# Repeatable application-only release. Never applies SQL or imports user data.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
MODE="${1:---check}"
if [[ "$MODE" != "--check" && "$MODE" != "--deploy" ]]; then
  echo 'Usage: release_public_beta.sh [--check|--deploy]' >&2; exit 2
fi
python3 - "$FRONTEND/.vercel/project.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
assert v['projectName']=='liubai-ledger-cloud-v2-preview'
assert v['projectId']=='prj_Ra6Bzpn2T1z0BiiC61FhBhiC0hu6'
assert v['orgId']=='team_aDZBTaEejPcweAPfcMYF63rs'
print('PASS expected isolated SaaS project')
PY
cd "$ROOT"
git diff --check
python3 scripts/check_cloud_v2.py
python3 -m py_compile scripts/e2e_public_launch.py scripts/e2e_shortcuts_v2.py
(
  cd "$FRONTEND"
  npm run typecheck
  npm run lint
  npm run test:ledger-ui
  npm run test:cloud-api
  npm audit --omit=dev --audit-level=high
  npm run build
)
if [[ "$MODE" == "--check" ]]; then
  echo 'PASS application release checks. No deployment or database mutation performed.'
  exit 0
fi
# Refuse to ship application code that expects unapplied planning/preferences tables.
python3 "$ROOT/scripts/check_planning_schema_ready.py" \
  --env-file "$FRONTEND/.env.saas.local" \
  --sslrootcert "$ROOT/.qa/supabase-prod-ca-2021.crt" \
  --expected-project-ref vhosvmnhdrzkhmkmptqg
cd "$ROOT"
if ! git diff --quiet HEAD -- frontend scripts; then
  echo 'Refuse deployment of uncommitted application/source changes.' >&2; exit 1
fi
SOURCE_REVISION="$(git rev-parse HEAD)"
cd "$FRONTEND"
vercel deploy --prod --yes --non-interactive --build-env "LEDGER_BUILD_REVISION=$SOURCE_REVISION"
cd "$ROOT"
python3 - "$FRONTEND/public/shortcuts" "$SOURCE_REVISION" <<'PY'
from pathlib import Path
from urllib.request import Request,urlopen
import hashlib,json,sys
base='https://app.blankspaces.uk'
for path in ['/connect','/privacy','/terms','/api/v2/health']:
 with urlopen(Request(base+path,headers={'User-Agent':'Mozilla/5.0 LedgerReleaseQA/1.0'}),timeout=30) as r:
  assert r.status==200
  if path.endswith('/health'):assert json.load(r)['ok']
 print('PASS',path)
with urlopen(Request(base+'/version.json',headers={'User-Agent':'Mozilla/5.0 LedgerReleaseQA/1.0','Cache-Control':'no-cache'}),timeout=30) as r:
 release=json.load(r)
 assert release.get('product')=='liubai-ledger'
 assert release.get('source_revision')==sys.argv[2], 'Deployed app revision does not match reviewed source'
 assert 'no-store' in (r.headers.get('Cache-Control') or ''), 'Release identity must not be served stale'
print('PASS published source revision',sys.argv[2][:12])
for name in ['Liubai-Cloud.shortcut','Liubai-Manual.shortcut']:
 with urlopen(Request(base+'/shortcuts/'+name,headers={'User-Agent':'Mozilla/5.0 LedgerReleaseQA/1.0'}),timeout=30) as r:
  content=r.read(2_000_000)
 local=(Path(sys.argv[1])/name).read_bytes()
 assert hashlib.sha256(content).digest()==hashlib.sha256(local).digest()
 print('PASS signed download hash',name)
PY
echo 'Deployment and smoke checks passed. Run synthetic production E2E separately; native iPhone acceptance is not implied.'
