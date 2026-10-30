#!/usr/bin/env bash
# Exercise scripts/install-clew.sh: local (untagged + tagged), github, and release.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
install="$root/scripts/install-clew.sh"
chmod +x "$install" "$root/scripts/install-clew.sh"

base=$(node -p "require('./package.json').version")
hash=$(git rev-parse --short HEAD)
stamp="$(TZ=UTC git show -s --format=%cd --date=format-local:%Y%m%d HEAD)-${hash}"
sha=$(git rev-parse HEAD)
prefix_root=$(mktemp -d)
temp_tag=""
cleanup() {
  if [[ -n "$temp_tag" ]]; then
    git tag -d "$temp_tag" >/dev/null 2>&1 || true
  fi
  rm -rf "$prefix_root"
}
trap cleanup EXIT

assert_version() {
  local prefix="$1"
  local want="$2"
  local bin="$prefix/bin/clew"
  local got
  if [[ ! -x "$bin" ]]; then
    echo "missing clew at $bin" >&2
    exit 1
  fi
  if "$bin" --version >/dev/null 2>&1; then
    got=$("$bin" --version)
  else
    got=$(node -p "require('${prefix}/lib/node_modules/clew/package.json').version")
  fi
  if [[ "$got" != "$want" ]]; then
    echo "version mismatch: want $want got $got" >&2
    exit 1
  fi
  echo "ok version=$got"
}

echo "== local (current HEAD) =="
prefix_local="$prefix_root/local"
mkdir -p "$prefix_local"
"$install" --from local "$root" --prefix "$prefix_local"
if git describe --tags --exact-match HEAD >/dev/null 2>&1; then
  assert_version "$prefix_local" "$base"
else
  assert_version "$prefix_local" "${base}-${stamp}"
fi
"$prefix_local/bin/clew" --help >/dev/null

echo "== local (exact tag, no hash suffix) =="
temp_tag="jef86-install-test-${hash}"
git tag -f "$temp_tag" HEAD
prefix_tagged="$prefix_root/tagged"
mkdir -p "$prefix_tagged"
"$install" --from local "$root" --prefix "$prefix_tagged"
assert_version "$prefix_tagged" "$base"
git tag -d "$temp_tag" >/dev/null
temp_tag=""

echo "== github (local bare stand-in via --git-url) =="
bare="$prefix_root/bare.git"
git clone --quiet --bare "$root" "$bare"
# Ensure the bare has the commit we are on (including unpushed commits).
git -C "$bare" fetch --quiet "$root" "+refs/heads/*:refs/heads/*" 2>/dev/null || true
prefix_gh="$prefix_root/github"
mkdir -p "$prefix_gh"
"$install" --from github "$sha" --git-url "$bare" --prefix "$prefix_gh"
if git describe --tags --exact-match HEAD >/dev/null 2>&1; then
  assert_version "$prefix_gh" "$base"
else
  assert_version "$prefix_gh" "${base}-${stamp}"
fi
"$prefix_gh/bin/clew" --help >/dev/null

echo "== release (local tarball path) =="
prefix_rel="$prefix_root/release"
mkdir -p "$prefix_rel"
release_tgz="$prefix_root/clew-${base}.tgz"
(
  cd "$root"
  rm -f clew-*.tgz
  packed=$(npm pack --silent | awk '/\.tgz$/{ print }')
  mv "$packed" "$release_tgz"
)
"$install" --from release "$release_tgz" --prefix "$prefix_rel"
assert_version "$prefix_rel" "$base"

if [[ "${CLEW_TEST_LIVE_RELEASE:-0}" == "1" ]] && \
  curl -fsI "https://github.com/goan15910/clew/releases/download/v0.1.0-alpha.2/clew-0.1.0-alpha.2.tgz" >/dev/null 2>&1; then
  echo "== release (GitHub asset v0.1.0-alpha.2) =="
  prefix_live="$prefix_root/release-live"
  mkdir -p "$prefix_live"
  "$install" --from release v0.1.0-alpha.2 --prefix "$prefix_live"
  assert_version "$prefix_live" "0.1.0-alpha.2"
fi

echo "install-clew tests ok"
