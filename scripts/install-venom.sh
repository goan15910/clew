#!/usr/bin/env bash
# Download the pinned Venom binary used by the end-to-end suites and CI.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
version=1.3.0
dest="$root/bin/venom"
url="https://github.com/ovh/venom/releases/download/v${version}/venom.linux-amd64"
sha=89832ec25e820c605cf0d3c09122e60bad43d13c1724aa6d375ef7109fbfe201

mkdir -p "$root/bin"
if [[ -f "$dest" ]] && echo "${sha}  ${dest}" | sha256sum -c - >/dev/null 2>&1; then
  exit 0
fi

tmp=$(mktemp)
curl -fsSL -o "$tmp" "$url"
echo "${sha}  ${tmp}" | sha256sum -c -
install -m 755 "$tmp" "$dest"
rm -f "$tmp"
