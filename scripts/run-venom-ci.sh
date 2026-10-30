#!/usr/bin/env bash
# Run every Venom suite in parallel (Venom 1.3.0 has no --parallel).
# Each suite writes to its own output dir, then XML/HTML/logs are flattened for
# scripts/venom-step-summary.mjs and the venom-report artifact.
set -euo pipefail

root=${1:-${GITHUB_WORKSPACE:-$PWD}}
clew=${2:-node dist/cli.js}
jobs=${VENOM_PARALLEL_JOBS:-4}
results=${VENOM_RESULTS_DIR:-venom-results}

mkdir -p "$results"

run_suite() {
  local suite=$1
  local name
  name=$(basename "$suite" .yml)
  local out="${results}/${name}"
  mkdir -p "$out"
  bin/venom run "$suite" \
    --format=xml \
    --output-dir="$out" \
    --html-report \
    --var "root=${root}" \
    --var "clew=${clew}"
}

export -f run_suite
export results root clew

# xargs -P: non-zero if any suite fails (exit 123/124/125/126/127 on GNU xargs).
status=0
printf '%s\0' tests/venom/*.yml | xargs -0 -P "$jobs" -n 1 bash -c 'run_suite "$1"' _ || status=$?

# Flatten for the step summary (reads *.xml in results/) and the upload paths.
# Always flatten so a partial failure still produces annotations and artifacts.
: >"${results}/venom.log"
shopt -s nullglob
for suite_dir in "${results}"/*/; do
  name=$(basename "$suite_dir")
  for xml in "${suite_dir}"*.xml; do
    cp "$xml" "${results}/"
  done
  for html in "${suite_dir}"*.html; do
    base=$(basename "$html")
    cp "$html" "${results}/${name}-${base}"
  done
  if [[ -f "${suite_dir}venom.log" ]]; then
    {
      echo "===== ${name} ====="
      cat "${suite_dir}venom.log"
      echo
    } >>"${results}/venom.log"
  fi
done

exit "$status"
