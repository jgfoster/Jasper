#!/usr/bin/env bash
#
# Run the Rowan end-to-end test headless in the container: it brings up a fresh
# Rowan-3 stone (stone-entrypoint.sh), launches VS Code under Xvfb, and drives
# the whole workflow — connect, add seaside-rowan from git, load, prove Seaside
# is in the image. Nothing opens on your desktop.
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p acceptance/playwright-report acceptance/test-results

docker build -f acceptance/Dockerfile -t jasper-acceptance .
docker volume create jasper-vscode-cache >/dev/null

exec docker run --rm --init --shm-size=1g \
  -v jasper-vscode-cache:/app/.vscode-test \
  -v "$PWD/acceptance/playwright-report:/app/acceptance/playwright-report" \
  -v "$PWD/acceptance/test-results:/app/acceptance/test-results" \
  jasper-acceptance \
  /app/acceptance/stone-entrypoint.sh \
  xvfb-run -a --server-args="-screen 0 1280x1024x24" \
  npm run test:acceptance -- rowan-e2e "$@"
