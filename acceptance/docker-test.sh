#!/usr/bin/env bash
#
# Build and run the acceptance suite headless in a Linux container. Nothing
# opens on your desktop — VS Code renders to a virtual X display inside the
# container. The HTML report and traces are written back to the host under
# acceptance/, so afterwards `npm run test:acceptance:report` shows them.
#
# Any arguments are passed through to `playwright test` inside the container,
# e.g. `npm run test:acceptance:docker -- isolation` to run one spec.
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p acceptance/playwright-report acceptance/test-results

docker build -f acceptance/Dockerfile -t jasper-acceptance .

# Cache the (large) VS Code download across runs in a named volume.
docker volume create jasper-vscode-cache >/dev/null

exec docker run --rm --init \
  --shm-size=1g \
  -v jasper-vscode-cache:/app/.vscode-test \
  -v "$PWD/acceptance/playwright-report:/app/acceptance/playwright-report" \
  -v "$PWD/acceptance/test-results:/app/acceptance/test-results" \
  jasper-acceptance \
  xvfb-run -a --server-args="-screen 0 1280x1024x24" \
  npm run test:acceptance -- "$@"
