#!/usr/bin/env bash
# Install Clew globally from a local checkout, a GitHub ref, or a GitHub Release tarball.
#
# Usage:
#   scripts/install-clew.sh [--prefix DIR]
#   scripts/install-clew.sh --from local [PATH] [--prefix DIR]
#   scripts/install-clew.sh --from github [REF] [--prefix DIR] [--repo OWNER/NAME] [--git-url URL]
#   scripts/install-clew.sh --from release [TAG|URL|PATH] [--prefix DIR] [--repo OWNER/NAME]
#
# Version stamp (written into the installed package.json with a build-info.json receipt
# that `clew upgrade` reads; reported by `clew --version`):
#   {tag}                          when the commit has an exact v* tag
#   {pkg}.dev.{commit count}+g{sha7}  otherwise (a stable {pkg} bumps its patch first)
# Receipt channel: local for --from local, head for --from github (release when the ref is a tag).
# --from release keeps the packed version and its receipt.
# --from release verifies the tarball against SHA256SUMS from the same release and fails closed.
# Without a tag, --from release installs the highest SemVer release, prereleases included.
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

stamp_script="$(cd "$(dirname "$0")" && pwd)/build-stamp.mjs"

# Re-pack a tarball with the version and build-info.json that build-stamp.mjs writes.
# Prints the stamped tarball path, then the stamped version.
stamp_tarball() {
  local tarball="$1"
  local git_dir="$2"
  local channel="$3"
  local extract="$work/extract"
  rm -rf "$extract"
  mkdir -p "$extract"
  tar -xzf "$tarball" -C "$extract"
  local version
  [[ -f "$stamp_script" ]] || stamp_script="$git_dir/scripts/build-stamp.mjs"
  version=$(node "$stamp_script" "$git_dir" "$extract/package" --channel "$channel")
  local stamped="$work/clew-${version}.tgz"
  tar -czf "$stamped" -C "$extract" package
  printf '%s\n%s\n' "$stamped" "$version"
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

pack_stamp_install() {
  local src="$1"
  local label="$2"
  local channel="$3"
  local tarball stamped version out
  tarball=$(pack_from_source "$src")
  [[ -n "$tarball" && -f "$src/$tarball" ]] || {
    echo "npm pack failed for $label" >&2
    exit 1
  }
  out=$(stamp_tarball "$src/$tarball" "$src" "$channel")
  stamped=$(printf '%s\n' "$out" | sed -n 1p)
  version=$(printf '%s\n' "$out" | sed -n 2p)
  rm -f "$src/$tarball"
  echo "packed $label as $version ($channel channel)"
  install_tarball "$stamped"
  rm -f "$stamped"
  report_version
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
  pack_stamp_install "$src" "local checkout $src" local
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
  pack_stamp_install "$clone" "${url}@${ref}" head
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Fail closed unless SHA256SUMS names the tarball and the hashes match.
verify_release_tarball() {
  local tarball="$1"
  local sums_url="$2"
  local name="$3"
  local sums="$work/SHA256SUMS"
  curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 60 \
    -fsSL -o "$sums" "$sums_url"
  local want got
  want=$(awk -v n="$name" '{ f=$2; sub(/^\*/, "", f); if (f == n) print $1 }' "$sums")
  [[ -n "$want" ]] || {
    echo "SHA256SUMS has no line for $name" >&2
    exit 1
  }
  got=$(sha256_of "$tarball")
  [[ "$want" == "$got" ]] || {
    echo "checksum mismatch for $name: SHA256SUMS $want, downloaded $got" >&2
    exit 1
  }
  echo "sha256 ok: $name"
}

# Highest SemVer tag across all releases, prereleases included, drafts excluded.
latest_release_tag() {
  curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 60 -fsSL \
    ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
    "https://api.github.com/repos/${repo}/releases?per_page=100" |
  node -e '
const releases = JSON.parse(require("fs").readFileSync(0, "utf8")).filter((r) => !r.draft);
const parse = (t) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(t);
  return m && { core: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [] };
};
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
};
const tags = releases.map((r) => r.tag_name).filter((t) => parse(t));
tags.sort((a, b) => cmp(parse(b), parse(a)));
if (!tags.length) { console.error("no releases found"); process.exit(1); }
console.log(tags[0]);
'
}

install_from_release() {
  local target="${source_arg:-}"
  local tarball="$work/release.tgz"

  if [[ -z "$target" ]]; then
    target=$(latest_release_tag)
    echo "newest release: $target"
  fi

  if [[ -f "$target" ]]; then
    cp "$target" "$tarball"
    echo "local tarball: skipping checksum (no SHA256SUMS to compare)"
  elif [[ "$target" == https://* || "$target" == http://* ]]; then
    curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 \
      -fsSL -o "$tarball" "$target"
    verify_release_tarball "$tarball" "$(dirname "$target")/SHA256SUMS" "$(basename "$target")"
  else
    local tag="$target"
    case "$tag" in
      v*) ;;
      *) tag="v${tag}" ;;
    esac
    local version="${tag#v}"
    local base="https://github.com/${repo}/releases/download/${tag}"
    echo "downloading ${base}/clew-${version}.tgz"
    curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 \
      -fsSL -o "$tarball" "${base}/clew-${version}.tgz"
    verify_release_tarball "$tarball" "${base}/SHA256SUMS" "clew-${version}.tgz"
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
