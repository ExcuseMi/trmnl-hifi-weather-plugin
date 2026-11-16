#!/usr/bin/env bash
# Push gate: runs `trmnlp lint` in plugin/ and fails on any finding that is not in tools/lint_baseline.txt.
# Baseline = the accepted findings of 2026-11-16 (the Legend field type, two ja link false positives); it may only shrink.
# Added 2026-11-16 after a <style> block and inline styles went into a commit unnoticed (trmnlp lint: framework_elements_used).
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
out=$(cd "$here/plugin" && timeout 300 trmnlp lint 2>&1) || true
findings=$(printf '%s\n' "$out" | sed -n -E 's/^ *[0-9]+\. (\[[a-z_]+\] .{0,60}).*/\1/p' | sort)
if ! printf '%s\n' "$out" | rg -q "issues? found|No issues"; then echo "RED: trmnlp lint gave no verdict:" >&2; printf '%s\n' "$out" | tail -5 >&2; exit 2; fi
new=$(comm -13 <(sort "$here/tools/lint_baseline.txt") <(printf '%s\n' "$findings"))
if [ -n "$new" ]; then echo "RED: new trmnlp lint findings:" >&2; printf '%s\n' "$new" >&2; exit 1; fi
echo GREEN
