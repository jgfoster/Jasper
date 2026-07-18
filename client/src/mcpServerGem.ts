/**
 * Managed launch/stop of the native GemStone MCP server gem.
 *
 * The server runs as the *blocking main activity of a dedicated gem*:
 * `GsMcpServer runOnPort:` never returns until stopped, and forked GsProcesses
 * only run while the gem is actively executing Smalltalk, so the accept loop
 * cannot live in the extension's own (parked) GCI session — it needs its own
 * topaz process. This mirrors seasideServer.ts, which serves a blocking Zinc
 * loop the same way; the process is detached (its own process group) so it
 * survives and can be signalled to stop.
 *
 * The launch boots the most capable installed server — the Grail subclass when
 * its class is present, else the base — matching resources/mcp-server/run-server.sh.
 */
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActiveSession } from './sessionManager';

/** Default port the native MCP server listens on (per the server README). */
export const MCP_SERVER_DEFAULT_PORT = 8000;

/** Running server gems, keyed by port, so we can stop them and avoid double-starts. */
const servers = new Map<number, ChildProcess>();

export interface StartMcpServerOptions {
  session: ActiveSession;
  /** GemStone install root (the `GemStone64Bit…` directory). */
  gemstonePath: string;
  /** GEMSTONE_GLOBAL_DIR — where topaz finds the NetLDI/stone locks. */
  globalDir: string;
  /** GemStone password for the session's user (used in the topaz login). */
  password: string;
  port?: number;
}

/** The `/mcp` endpoint URL a running server is reachable at. */
export function mcpServerUrl(port = MCP_SERVER_DEFAULT_PORT): string {
  return `http://localhost:${port}/mcp`;
}

export function isMcpServerRunning(port = MCP_SERVER_DEFAULT_PORT): boolean {
  return servers.has(port);
}

/**
 * Start the native MCP server in a detached gem and wait until it answers an
 * `initialize` over the Streamable HTTP transport. Requires the `GsMcp*` classes
 * to already be installed and committed (see mcpServerInstall.ts). Returns the
 * `/mcp` URL once it is serving.
 */
export async function startMcpServerGem(opts: StartMcpServerOptions): Promise<string> {
  const port = opts.port ?? MCP_SERVER_DEFAULT_PORT;
  const url = mcpServerUrl(port);
  if (servers.has(port)) return url;

  const { login } = opts.session;
  // Boot the Grail subclass when its class is installed, else the base server —
  // resolved in-image so a base-only install still launches. Matches run-server.sh.
  const bootExpr =
    '((System myUserProfile objectNamed: #GsMcpServerWithGrail) ' +
    'ifNil: [GsMcpServer] ifNotNil: [:cls | cls]) runOnPort: ' +
    `${port}.`;
  const script =
    [
      `set gemstone ${login.stone}`,
      `set user ${login.gs_user}`,
      `set pass ${opts.password}`,
      'login',
      'run',
      bootExpr,
      '%',
    ].join('\n') + '\n';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GEMSTONE: opts.gemstonePath,
    GEMSTONE_GLOBAL_DIR: opts.globalDir,
    PATH: `${opts.gemstonePath}/bin:${process.env.PATH ?? ''}`,
  };
  if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = `${opts.gemstonePath}/lib`;
  else env.LD_LIBRARY_PATH = `${opts.gemstonePath}/lib`;

  const logPath = path.join(os.tmpdir(), `jasper-mcp-server-${port}.log`);
  const log = fs.openSync(logPath, 'w');
  const child = spawn(path.join(opts.gemstonePath, 'bin', 'topaz'), ['-l'], {
    env,
    detached: true,
    stdio: ['pipe', log, log],
  });
  child.stdin?.write(script);
  child.stdin?.end();
  child.unref();
  servers.set(port, child);
  child.once('exit', () => servers.delete(port));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await respondsToInitialize(url)) return url;
    await new Promise((r) => setTimeout(r, 1_000));
  }

  stopMcpServerGem(port);
  const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-1200) : '';
  throw new Error(
    `The MCP server on port ${port} did not respond. Are the GsMcp* classes installed and ` +
      `committed? Log:\n${tail}`,
  );
}

/** POST a minimal `initialize` and check the server answers with a JSON-RPC
 *  result carrying the server's identity. */
async function respondsToInitialize(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes('protocolVersion') || body.includes('gemstone-mcp');
  } catch {
    return false; // not up yet
  }
}

/** Stop the server gem on `port`. Returns true if one was running. */
export function stopMcpServerGem(port = MCP_SERVER_DEFAULT_PORT): boolean {
  const child = servers.get(port);
  if (!child) return false;
  servers.delete(port);
  try {
    // Negative pid signals the whole detached process group.
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  return true;
}

/** Stop every running server gem (used on extension deactivate). */
export function stopAllMcpServerGems(): void {
  for (const port of [...servers.keys()]) stopMcpServerGem(port);
}
