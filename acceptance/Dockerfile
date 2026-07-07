# Headless acceptance-test runner.
#
# Runs the Playwright + VS Code acceptance suite inside a Linux container under
# Xvfb (a virtual framebuffer), so the real VS Code window renders to an
# off-machine display and never appears on the developer's desktop. This is the
# same way the suite runs in CI.
#
# The base image ships Node, the Playwright browsers, their shared libraries,
# and Xvfb. We add the extra libraries VS Code's Electron needs beyond Chromium,
# plus the toolchain to build this repo's native node modules (koffi, keytar).
FROM mcr.microsoft.com/playwright:v1.61.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends \
      libsecret-1-0 \
      libsecret-1-dev \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libasound2t64 \
      build-essential \
      python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first, keyed only on the manifests, so edits to source
# don't bust the (slow) npm ci layer. All workspace manifests are needed for the
# workspace-aware install.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY mcp-server/package.json ./mcp-server/
RUN npm ci

COPY . .

# The extension must be built for VS Code to load it from source.
RUN npm run compile:client

# `xvfb-run` gives the run a virtual X display; VS Code renders there.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "npm", "run", "test:acceptance"]
