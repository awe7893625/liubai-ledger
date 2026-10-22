#!/usr/bin/env bash
# Compatibility entrypoint. Provisioning/migrations are no longer part of app release.
# The former script reapplied the initial schema and rebuilt a Vercel-only Shortcut.
# Use the reviewed public release gate; default is checks only (no deployment).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/scripts/release_public_beta.sh" "$@"
