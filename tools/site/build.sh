#!/bin/sh
# One command: regenerate docs/ (the "try it" site). --check: fail when docs/ is out of date.
cd "$(dirname "$0")/../.." && exec node tools/site/build.js "$@"
