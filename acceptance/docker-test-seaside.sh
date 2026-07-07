#!/usr/bin/env bash
#
# Run the Seaside Hello World end-to-end test headless in the container: bring up
# a Rowan-3 stone, launch VS Code under Xvfb, install Seaside + a Hello World
# Seaside app through Jasper (as Rowan projects), serve it from GemStone, and
# view it in VS Code's integrated browser. Nothing opens on your desktop.
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p acceptance/playwright-report acceptance/test-results

docker build -f acceptance/Dockerfile -t jasper-acceptance .

if [ "$(docker volume inspect -f '{{.Labels.owner}}' jasper-vscode-cache 2>/dev/null)" != "pwuser" ]; then
  docker volume rm jasper-vscode-cache >/dev/null 2>&1 || true
  docker volume create --label owner=pwuser jasper-vscode-cache >/dev/null
fi

exec docker run --rm --init --shm-size=1g \
  -v jasper-vscode-cache:/app/.vscode-test \
  -v "$PWD/acceptance/playwright-report:/app/acceptance/playwright-report" \
  -v "$PWD/acceptance/test-results:/app/acceptance/test-results" \
  jasper-acceptance \
  /app/acceptance/stone-entrypoint.sh \
  xvfb-run -a --server-args="-screen 0 1280x1024x24" \
  npm run test:acceptance -- seaside-helloworld "$@"
