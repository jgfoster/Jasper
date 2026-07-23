#!/usr/bin/env bash
#
# Build and run the acceptance suite headless in a Linux container. Nothing
# opens on your desktop — VS Code renders to a virtual X display inside the
# container. The HTML report and traces are written back to the host under
# acceptance/, so afterwards `npm run test:acceptance:report` shows them.
#
# A fresh Rowan-3 stone comes up first (stone-entrypoint.sh): a pristine extent
# copy and a startstone, seconds, with GemStone already in the image. Loading a
# project into a database is most of what Rowan is for, so the routine run has a
# database to load into. Specs that clone from the internet stay out of it —
# see JASPER_ONLINE_SPECS.
#
# Any arguments are passed through to `playwright test` inside the container,
# e.g. `npm run test:acceptance:docker -- isolation` to run one spec.
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p acceptance/playwright-report acceptance/test-results

docker build -f acceptance/Dockerfile -t jasper-acceptance .

# Cache the (large) VS Code download across runs in a named volume. The
# container runs as pwuser, so ensure the volume is owned by pwuser by
# (re)creating it from the image's pwuser-owned mount point.
if [ "$(docker volume inspect -f '{{.Labels.owner}}' jasper-vscode-cache 2>/dev/null)" != "pwuser" ]; then
  docker volume rm jasper-vscode-cache >/dev/null 2>&1 || true
  docker volume create --label owner=pwuser jasper-vscode-cache >/dev/null
fi

exec docker run --rm --init \
  --shm-size=1g \
  `# Pass the online gate through when the host sets it, so a network-bound` \
  `# scenario can be run on demand: JASPER_ONLINE_SPECS=1 npm run test:acceptance:docker` \
  -e JASPER_ONLINE_SPECS \
  -v jasper-vscode-cache:/app/.vscode-test \
  -v "$PWD/acceptance/playwright-report:/app/acceptance/playwright-report" \
  -v "$PWD/acceptance/test-results:/app/acceptance/test-results" \
  jasper-acceptance \
  /app/acceptance/stone-entrypoint.sh \
  xvfb-run -a --server-args="-screen 0 1280x1024x24" \
  npm run test:acceptance -- "$@"
