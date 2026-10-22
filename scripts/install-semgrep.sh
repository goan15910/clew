#!/usr/bin/env bash
# Install the pinned Semgrep CLI into .venv-semgrep. No Semgrep account.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
version=1.182.1
venv="$root/.venv-semgrep"

if [[ -x "$venv/bin/semgrep" ]] && [[ "$("$venv/bin/semgrep" --version | head -n 1)" == "$version" ]]; then
  exit 0
fi

if ! python3 -m venv "$venv"; then
  rm -rf "$venv"
  if command -v sudo >/dev/null && command -v apt-get >/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3-venv
  fi
  python3 -m venv "$venv"
fi
"$venv/bin/pip" install --disable-pip-version-check --quiet "semgrep==${version}"
"$venv/bin/semgrep" --version
