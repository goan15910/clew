#!/usr/bin/env bash
# Install Graphviz 16.1.0. Ubuntu's apt package is 2.42, which predates the chart SVG this repo renders.
#
# Optional GRAPHVIZ_CACHE_DIR: persist the upstream Graphviz debs and the apt dependency
# debs harvested on a cold install. A warm restore installs from those local debs and skips
# apt-get update / network fetches. Wire it with actions/cache in CI.
set -euo pipefail

version=16.1.0
export DEBIAN_FRONTEND=noninteractive
# `command -v` so a missing `dot` does not run Ubuntu's command-not-found handler,
# which can take the apt lock and leave the rest of this script waiting.
if command -v dot >/dev/null 2>&1 && dot -V 2>&1 | grep -q "graphviz version ${version}"; then
  dot -V
  exit 0
fi

if [[ ! -r /etc/os-release ]]; then
  echo "install-graphviz.sh supports Ubuntu. Install Graphviz ${version} and retry." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${VERSION_ID}" in
  22.04|24.04|26.04) ubuntu="${VERSION_ID}" ;;
  *)
    echo "no official Graphviz ${version} package for Ubuntu ${VERSION_ID}" >&2
    exit 1
    ;;
esac

cache="${GRAPHVIZ_CACHE_DIR:-}"
lib_deb="libgraphviz4_${version}-1_amd64.deb"
gv_deb="graphviz_${version}-1_amd64.deb"

decode_deb_names() {
  local dir=$1
  [[ -d "$dir" ]] || return 0
  local f base fixed
  shopt -s nullglob
  for f in "$dir"/*.deb; do
    base=$(basename "$f")
    # apt stores "epoch:" as "%3a" under Dir::Cache::Archives; dpkg wants a literal colon.
    fixed=${base//%3a/:}
    if [[ "$base" != "$fixed" ]]; then
      mv "$f" "$(dirname "$f")/$fixed"
    fi
  done
}

install_local_debs() {
  local dir=$1
  local -a debs=()
  local f
  while IFS= read -r -d '' f; do
    debs+=("$f")
  done < <(find "$dir" -name '*.deb' -print0 | sort -z)
  if [[ ${#debs[@]} -eq 0 ]]; then
    return 1
  fi
  decode_deb_names "$dir"
  decode_deb_names "$dir/deps"
  debs=()
  while IFS= read -r -d '' f; do
    debs+=("$f")
  done < <(find "$dir" -name '*.deb' -print0 | sort -z)
  # dpkg orders poorly across many packages; install everything then finish deps offline.
  sudo dpkg -i "${debs[@]}" || true
  sudo apt-get install -f -y \
    -o APT::Get::Download=false \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold
}

mark_ready() {
  local dir=$1
  printf '%s\n' "$version" >"${dir}/version"
  printf '%s\n' "$ubuntu" >"${dir}/ubuntu"
  # Drop apt lock/partial dirs so actions/cache stays small and portable.
  rm -rf "${dir}/partial" "${dir}/deps/partial" "${dir}/lock" "${dir}/deps/lock"
  : >"${dir}/ready"
}

if [[ -n "$cache" && -f "${cache}/ready" && -f "${cache}/version" && -f "${cache}/ubuntu" ]]; then
  if [[ $(cat "${cache}/version") == "$version" && $(cat "${cache}/ubuntu") == "$ubuntu" ]]; then
    echo "Installing Graphviz ${version} from ${cache} (warm cache)"
    if install_local_debs "$cache" && command -v dot >/dev/null 2>&1 && dot -V 2>&1 | grep -q "graphviz version ${version}"; then
      dot -V
      exit 0
    fi
    echo "Warm Graphviz cache failed; falling back to a cold install" >&2
    rm -f "${cache}/ready"
    # Repair half-configured packages left by the offline attempt before the cold path.
    sudo apt-get install -f -y \
      -o Dpkg::Options::=--force-confdef \
      -o Dpkg::Options::=--force-confold || true
  fi
fi

asset="ubuntu_${ubuntu}_graphviz-${version}-debs.tar.xz"
url="https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${version}/${asset}"

if [[ -n "$cache" ]]; then
  mkdir -p "${cache}/deps/partial"
  if [[ ! -f "${cache}/${asset}" ]]; then
    curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 -fsSL -o "${cache}/${asset}" "$url"
  fi
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  tar -xJf "${cache}/${asset}" -C "$tmp"
  cp "${tmp}/${lib_deb}" "${tmp}/${gv_deb}" "${cache}/"
  sudo apt-get update -qq
  # Harvest dependency debs into the cache for the next warm restore.
  sudo apt-get install -y \
    -o Dir::Cache::Archives="${cache}/deps" \
    -o APT::Keep-Downloaded-Packages=true \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    "${cache}/${lib_deb}" "${cache}/${gv_deb}"
  sudo chmod -R a+rX "$cache" || true
  decode_deb_names "${cache}/deps"
  # Only mark warm-ready when apt actually downloaded dependency debs into the cache.
  # A host that already had those packages installed would otherwise cache just the two
  # Graphviz debs and break the next offline restore.
  dep_count=$(find "${cache}/deps" -name '*.deb' 2>/dev/null | wc -l | tr -d ' ')
  if [[ "${dep_count}" -ge 5 ]]; then
    mark_ready "$cache"
  else
    echo "Graphviz dependency debs were not harvested (${dep_count}); warm cache left unmarked"
  fi
else
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 -fsSL -o "${tmp}/debs.tar.xz" "$url"
  tar -xJf "${tmp}/debs.tar.xz" -C "$tmp"
  sudo apt-get update -qq
  sudo dpkg -i "${tmp}/${lib_deb}" "${tmp}/${gv_deb}" \
    || sudo apt-get install -f -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold
fi

dot -V
