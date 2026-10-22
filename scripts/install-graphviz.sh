#!/usr/bin/env bash
# Install Graphviz 16.1.0. Ubuntu's apt package is 2.42, which predates the chart SVG this repo renders.
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

asset="ubuntu_${ubuntu}_graphviz-${version}-debs.tar.xz"
url="https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${version}/${asset}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 180 -fsSL -o "${tmp}/debs.tar.xz" "$url"
tar -xJf "${tmp}/debs.tar.xz" -C "$tmp"
sudo apt-get update -qq
sudo dpkg -i "${tmp}/libgraphviz4_${version}-1_amd64.deb" "${tmp}/graphviz_${version}-1_amd64.deb" \
  || sudo apt-get install -f -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold
dot -V
