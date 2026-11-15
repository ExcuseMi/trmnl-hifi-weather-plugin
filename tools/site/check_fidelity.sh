#!/bin/sh
# Guard for the site: same markup from the page's engine (LiquidJS) and from trmnlp (Ruby Liquid). No browser is started.
set -e
root="$(cd "$(dirname "$0")/../.." && pwd)"
d="$(mktemp -d)"; mkdir -p "$d/out"
trap 'rm -rf "$d"' EXIT
node "$root/tools/site/check_fidelity.mjs" prep "$d"
(cd "$root/plugin" && SW_FID_IN="$d/cases.json" SW_FID_OUT="$d/out" trmnlp test "$root/tools/site/fidelity_spec.rb" >/dev/null)
node "$root/tools/site/check_fidelity.mjs" compare "$d"
