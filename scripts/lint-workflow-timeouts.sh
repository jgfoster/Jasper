#!/usr/bin/env bash
#
# Fails if any job in .github/workflows/*.yml has no timeout-minutes —
# without one, a hang inherits GitHub's 360-minute default instead of
# failing fast.
#
# Requires yq (mikefarah, Go): https://github.com/mikefarah/yq. Preinstalled
# on GitHub-hosted runners, so CI needs no setup step. Running this locally
# requires installing it yourself (e.g. `brew install yq` on macOS) — see
# https://github.com/mikefarah/yq#install for other platforms.

set -euo pipefail

if ! command -v yq >/dev/null 2>&1; then
    echo "error: yq is required but not installed on this machine." >&2
    echo "Install it from https://github.com/mikefarah/yq#install (e.g. \`brew install yq\` on macOS), then re-run." >&2
    exit 1
fi

missing=0

for file in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -e "$file" ] || continue

    while IFS= read -r job; do
        missing=1
        echo "  - $file: job \"$job\" has no timeout-minutes"
    done < <(
        yq eval '.jobs // {} | to_entries | .[] | select(.value["timeout-minutes"] == null) | .key' "$file"
    )
done

if [ "$missing" -eq 1 ]; then
    echo
    echo "Add timeout-minutes to each job above so a hang fails fast instead of running for GitHub's 360-minute default." >&2
    exit 1
fi

echo "timeout-minutes set on every job."
