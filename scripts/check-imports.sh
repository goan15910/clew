#!/usr/bin/env bash
# Semgrep scan of src with the local Clew rules. Does not log in or fetch a registry.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bash "$root/scripts/install-semgrep.sh"
export SEMGREP_SEND_METRICS=off
exec "$root/.venv-semgrep/bin/semgrep" scan \
  --config "$root/semgrep/clew.yml" \
  --metrics=off \
  --disable-version-check \
  --error \
  --quiet \
  src
