#!/usr/bin/env bash
# Push gate: exits 0 only when every rspec summary in the given output file(s) reads "N examples, 0 failures",
# there is at least one summary per file, and no failed-example line ("rspec ... # ...") is present.
# Added 2026-11-15 after a push went live while one of two suites was red (only the last summary was checked).
set -u
[ $# -ge 1 ] || { echo "usage: tools/suite_green.sh <rspec output>..." >&2; exit 2; }
bad=0
for f in "$@"; do
  sums=$(grep -E '^[0-9]+ examples?, [0-9]+ failures?' "$f" || true)
  if [ -z "$sums" ]; then echo "RED $f: no rspec summary" >&2; bad=1; continue; fi
  if echo "$sums" | grep -qvE ' 0 failures'; then echo "RED $f: $(echo "$sums" | tr '\n' ' ')" >&2; bad=1; fi
  if grep -qE '^rspec .*#' "$f"; then echo "RED $f: failed examples listed" >&2; bad=1; fi
done
[ $bad -eq 0 ] && echo GREEN
exit $bad
