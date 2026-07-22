#!/usr/bin/env bash
#
# Warns (stderr, colored) when a git checkout/merge/rewrite brings in a
# changed root package-lock.json, so you know to run `npm install`. Prints a
# plain confirmation to stdout when nothing changed, so the hook job never
# looks like it silently did nothing. Never blocks or fails the git
# operation it's hooked into — always exits 0.
#
# Usage: bash scripts/warn-outdated-packages.sh <mode> [git-hook-args...]
#   post-checkout: warn-outdated-packages.sh post-checkout <old> <new> <flag>
#   post-merge:    warn-outdated-packages.sh post-merge
#   post-rewrite:  warn-outdated-packages.sh post-rewrite

set -euo pipefail

mode="${1:-}"

case "$mode" in
    post-checkout)
        old="${2:-}"
        new="${3:-}"
        flag="${4:-}"

        # flag=0 is a file checkout (e.g. `git checkout -- file`), not a
        # branch switch — nothing relevant to warn about.
        [ "$flag" = "1" ] || exit 0

        # All-zeros old ref means there was no previous HEAD (fresh clone,
        # or checking out into an unborn branch) — nothing to compare.
        case "$old" in
            0000000000000000000000000000000000000000) exit 0 ;;
        esac
        ;;
    post-merge | post-rewrite)
        # No refs are passed for these hooks; ORIG_HEAD is git's pointer to
        # the pre-operation tip. If it doesn't resolve, there's nothing to
        # diff against.
        if ! git rev-parse --verify --quiet ORIG_HEAD >/dev/null; then
            exit 0
        fi
        old="ORIG_HEAD"
        new="HEAD"
        ;;
    *)
        exit 0
        ;;
esac

[ "$old" = "$new" ] && exit 0

# git diff --quiet exits 0 (identical), 1 (differs), or >1 (error, e.g. a
# bad ref). Capture the code explicitly rather than `if ! cmd`, which would
# treat an error the same as "differs" and warn spuriously.
diff_status=0
git diff --quiet "$old" "$new" -- package-lock.json 2>/dev/null || diff_status=$?

if [ "$diff_status" -eq 1 ]; then
    # Bold yellow, unless the caller opted out via NO_COLOR (https://no-color.org/).
    if [ -n "${NO_COLOR:-}" ]; then
        bold_yellow=""
        reset=""
    else
        bold_yellow=$'\033[1;33m'
        reset=$'\033[0m'
    fi
    printf '%s\n' "${bold_yellow}🚨 WARNING: root package-lock.json changed — run \`npm install\` to sync your dependencies.${reset}" >&2
else
    echo "package-lock.json unchanged."
fi

exit 0
