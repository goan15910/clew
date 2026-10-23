#!/usr/bin/env bash
# Pack the tarball, install it into a clean prefix, and run the client commands.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

rm -f clew-*.tgz
tarball=$(npm pack | awk '/\.tgz$/{ name=$0 } END { print name }')
if [[ -z "$tarball" || ! -f "$tarball" ]]; then
  echo "npm pack did not produce a tarball" >&2
  exit 1
fi

prefix=$(mktemp -d)
smoke=$(mktemp -d)
cache=$(mktemp -d)
cleanup() {
  rm -rf "$prefix" "$smoke" "$cache"
}
trap cleanup EXIT

# Empty cache and a dead registry: the tarball must carry its own dependencies.
npm install -g "$root/$tarball" --prefix "$prefix" --offline --cache "$cache" --registry "http://127.0.0.1:9"
cp -R "$root/examples" "$smoke/examples"

"$prefix/bin/clew" --help
"$prefix/bin/clew" verify \
  "$smoke/examples/todo/b-full.yaml" \
  "$smoke/examples/todo/workflows.yaml"

echo "smoke ok: $tarball"
