#!/usr/bin/env bash
# Install Clew globally from a local checkout, a GitHub ref, or a GitHub Release tarball.
#
# Usage:
#   scripts/install-clew.sh [--prefix DIR]
#   scripts/install-clew.sh --from local [PATH] [--prefix DIR]
#   scripts/install-clew.sh --from github [REF] [--prefix DIR] [--repo OWNER/NAME] [--git-url URL]
#   scripts/install-clew.sh --from release [TAG|URL|PATH] [--prefix DIR] [--repo OWNER/NAME]
#
# Version stamp (written into the installed package.json; reported by `clew --version`
# on builds that support that flag):
#   ${package.json version}[-${short git commit hash}]
# The hash suffix is applied only for --from local when HEAD has no exact git tag.
# GitHub and release installs keep the package.json / release version as-is.
set -euo pipefail

repo_default="goan15910/clew"
from="local"
source_arg=""
prefix=""
repo="$repo_default"
git_url=""
explicit_from=0

usage() {
  awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      [[ $# -ge 2 ]] || usage
      from="$2"
      explicit_from=1
      shift 2
      ;;
    --prefix)
      [[ $# -ge 2 ]] || usage
      prefix="$2"
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || usage
      repo="$2"
      shift 2
      ;;
    --git-url)
      [[ $# -ge 2 ]] || usage
      git_url="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      ;;
    *)
      if [[ -z "$source_arg" ]]; then
        source_arg="$1"
        shift
      else
        echo "unexpected argument: $1" >&2
        usage
      fi
      ;;
  esac
done

case "$from" in
  local|github|release) ;;
  *)
    echo "--from must be local, github, or release (got: $from)" >&2
    exit 2
    ;;
esac

work=$(mktemp -d)
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

npm_global=(npm install -g)
if [[ -n "$prefix" ]]; then
  npm_global+=(--prefix "$prefix")
fi

read_pkg_version() {
  local dir="$1"
  node -p "require('${dir}/package.json').version"
}

short_hash() {
  local dir="$1"
  git -C "$dir" rev-parse --short HEAD
}

has_exact_tag() {
  local dir="$1"
  git -C "$dir" describe --tags --exact-match HEAD >/dev/null 2>&1
}

# Rewrite package/package.json version inside an npm-pack layout, then retar.
stamp_tarball_version() {
  local tarball="$1"
  local version="$2"
  local extract="$work/extract"
  rm -rf "$extract"
  mkdir -p "$extract"
  tar -xzf "$tarball" -C "$extract"
  node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[1];
const version = process.argv[2];
const pkg = JSON.parse(readFileSync(file, 'utf8'));
pkg.version = version;
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
" "${extract}/package/package.json" "$version"
  local stamped="$work/clew-${version}.tgz"
  tar -czf "$stamped" -C "$extract" package
  printf '%s\n' "$stamped"
}

pack_from_source() {
  local src="$1"
  (
    cd "$src"
    if [[ ! -d node_modules ]]; then
      if [[ -f package-lock.json ]]; then
        npm ci >&2
      else
        npm install >&2
      fi
    fi
    rm -f clew-*.tgz
    # npm pack prints the filename on stdout; keep notices off stdout so callers
    # can capture a single path.
    npm pack --silent | awk '/\.tgz$/{ name=$0 } END { print name }'
  )
}

install_tarball() {
  local tarball="$1"
  "${npm_global[@]}" "$tarball"
}

resolve_clew_bin() {
  if [[ -n "$prefix" && -x "$prefix/bin/clew" ]]; then
    printf '%s\n' "$prefix/bin/clew"
    return
  fi
  if command -v clew >/dev/null 2>&1; then
    command -v clew
    return
  fi
  echo "clew binary not found after install" >&2
  exit 1
}

report_version() {
  local bin
  bin=$(resolve_clew_bin)
  if "$bin" --version >/dev/null 2>&1; then
    echo "installed: $("$bin" --version)"
  else
    local pkg
    if [[ -n "$prefix" ]]; then
      pkg="$prefix/lib/node_modules/clew/package.json"
    else
      pkg="$(npm root -g)/clew/package.json"
    fi
    echo "installed: $(node -p "require('${pkg}').version") (clew --version unavailable in this build)"
  fi
}

ensure_git_repo() {
  local dir="$1"
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "not a git checkout: $dir (needed to decide the version stamp)" >&2
    exit 2
  fi
}

install_from_local() {
  local src
  if [[ -n "$source_arg" ]]; then
    src=$(cd "$source_arg" && pwd)
  else
    src=$(cd "$(dirname "$0")/.." && pwd)
  fi
  [[ -f "$src/package.json" ]] || {
    echo "no package.json in $src" >&2
    exit 2
  }
  ensure_git_repo "$src"

  local base version tarball stamped
  base=$(read_pkg_version "$src")
  if has_exact_tag "$src"; then
    version="$base"
  else
    version="${base}-$(short_hash "$src")"
  fi

  echo "packing local checkout $src as $version"
  tarball=$(pack_from_source "$src")
  [[ -n "$tarball" && -f "$src/$tarball" ]] || {
    echo "npm pack failed in $src" >&2
    exit 1
  }
  if [[ "$version" == "$base" ]]; then
    stamped="$src/$tarball"
  else
    stamped=$(stamp_tarball_version "$src/$tarball" "$version")
    rm -f "$src/$tarball"
  fi
  install_tarball "$stamped"
  [[ "$stamped" == "$src/$tarball" ]] || rm -f "$stamped"
  report_version
}

install_from_github() {
  local ref="${source_arg:-main}"
  local clone="$work/clone"
  local url="${git_url:-https://github.com/${repo}.git}"
  echo "cloning ${url} @ ${ref}"
  git clone --quiet "$url" "$clone"
  if [[ "$ref" != "main" && "$ref" != "master" ]]; then
    if git -C "$clone" checkout --quiet "$ref" 2>/dev/null; then
      :
    else
      git -C "$clone" fetch --quiet --tags origin 2>/dev/null || true
      git -C "$clone" fetch --quiet origin "$ref" 2>/dev/null || git -C "$clone" fetch --quiet origin "+refs/heads/*:refs/remotes/origin/*"
      git -C "$clone" checkout --quiet "$ref"
    fi
  fi

  local version tarball
  version=$(read_pkg_version "$clone")
  echo "packing ${url}@${ref} as $version (no commit-hash suffix)"
  tarball=$(pack_from_source "$clone")
  [[ -n "$tarball" && -f "$clone/$tarball" ]] || {
    echo "npm pack failed for ${url}@${ref}" >&2
    exit 1
  }
  install_tarball "$clone/$tarball"
  report_version
}

install_from_release() {
  local target="${source_arg:-}"
  local tarball="$work/release.tgz"

  if [[ -z "$target" ]]; then
    target=$(gh release view --repo "$repo" --json tagName --jq .tagName)
  fi

  if [[ -f "$target" ]]; then
    cp "$target" "$tarball"
  elif [[ "$target" == https://* || "$target" == http://* ]]; then
    curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 \
      -fsSL -o "$tarball" "$target"
  else
    local tag="$target"
    case "$tag" in
      v*) ;;
      *) tag="v${tag}" ;;
    esac
    local version="${tag#v}"
    local url="https://github.com/${repo}/releases/download/${tag}/clew-${version}.tgz"
    echo "downloading $url"
    curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 \
      -fsSL -o "$tarball" "$url"
  fi

  echo "installing release tarball (version left as packed)"
  install_tarball "$tarball"
  report_version
}

# Bare invocation with a path and no --from stays local; a lone URL/tag needs --from.
if [[ $explicit_from -eq 0 && -n "$source_arg" ]]; then
  if [[ "$source_arg" == https://* || "$source_arg" == http://* || "$source_arg" == *.tgz ]]; then
    echo "pass --from release for a tarball URL or path" >&2
    exit 2
  fi
fi

case "$from" in
  local) install_from_local ;;
  github) install_from_github ;;
  release) install_from_release ;;
esac
