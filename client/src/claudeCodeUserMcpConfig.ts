import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MCP_SERVER_NAME,
  LEGACY_MCP_SERVER_NAME,
  isJasperProxyEntry,
  proxyScriptPath,
} from './mcpSocketServer';

/**
 * Claude Code reads its MCP server list from `~/.claude.json`. Entries under
 * the top-level `mcpServers` key are user-scope and visible from every
 * directory; entries under `projects.<cwd>.mcpServers` are project-scope
 * (which is what `claude mcp add` writes). Jasper now writes only the
 * user-scope entry so the jasper tools are available everywhere — same
 * model as Anthropic's hosted Gmail/Drive/Calendar connectors.
 *
 * On every activation we also clean up leftovers from earlier Jasper
 * versions: project-scope entries with our own name, and the pre-rename
 * `gemstone` entry (top-level and project-scope) that older versions wrote —
 * but only when it's still Jasper's own proxy, so we never touch a foreign
 * `gemstone` entry such as the GemStone-native MCP server's.
 */

export function claudeCodeUserConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

interface ProjectEntry {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

interface ClaudeCodeUserConfig {
  mcpServers?: Record<string, unknown>;
  projects?: Record<string, ProjectEntry>;
  [k: string]: unknown;
}

function readUserConfig(configPath: string): ClaudeCodeUserConfig {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Don't clobber a corrupt file with our own contents — let Claude Code
    // recreate it on next launch and skip this activation's write.
    return { __unreadable__: true };
  }
}

function writeUserConfig(configPath: string, settings: ClaudeCodeUserConfig): void {
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Idempotently write the user-scope `jasper` MCP entry to `~/.claude.json`,
 * remove any stale project-scope entries with the same name, and remove the
 * pre-rename `gemstone` entry (top-level and project-scope) when it is still
 * Jasper's own proxy. Returns the config path plus whether the file was
 * actually updated.
 *
 * Skips the write entirely if `~/.claude.json` is missing or unreadable —
 * we don't create that file ourselves; Claude Code owns its lifecycle.
 */
export function writeClaudeCodeUserMcpConfig(
  extensionPath: string,
  socketPath: string,
): { path: string; updated: boolean; skipped?: 'missing' | 'unreadable' } {
  const configPath = claudeCodeUserConfigPath();
  if (!fs.existsSync(configPath)) {
    return { path: configPath, updated: false, skipped: 'missing' };
  }
  const settings = readUserConfig(configPath);
  if ((settings as { __unreadable__?: boolean }).__unreadable__) {
    return { path: configPath, updated: false, skipped: 'unreadable' };
  }

  const desired = {
    type: 'stdio',
    command: 'node',
    args: [proxyScriptPath(extensionPath), '--proxy-socket', socketPath],
    env: {},
  };

  const mcpServers = settings.mcpServers ?? {};
  let dirty = false;
  if (JSON.stringify(mcpServers[MCP_SERVER_NAME]) !== JSON.stringify(desired)) {
    mcpServers[MCP_SERVER_NAME] = desired;
    dirty = true;
  }
  // Remove the pre-rename top-level `gemstone` entry, but only if it's still
  // our own proxy entry — never a foreign `gemstone` (e.g. the native server).
  if (isJasperProxyEntry(mcpServers[LEGACY_MCP_SERVER_NAME])) {
    delete mcpServers[LEGACY_MCP_SERVER_NAME];
    dirty = true;
  }

  if (settings.projects) {
    for (const proj of Object.values(settings.projects)) {
      const projMcp = proj?.mcpServers;
      if (!projMcp) {
        continue;
      }
      // Our own name at project scope is always stale — user-scope is now the
      // single source of truth.
      if (MCP_SERVER_NAME in projMcp) {
        delete projMcp[MCP_SERVER_NAME];
        dirty = true;
      }
      // Pre-rename `gemstone` project entries (from older `claude mcp add`
      // shell-outs), but only our own proxy entries — never a foreign one.
      if (
        LEGACY_MCP_SERVER_NAME in projMcp &&
        isJasperProxyEntry(projMcp[LEGACY_MCP_SERVER_NAME])
      ) {
        delete projMcp[LEGACY_MCP_SERVER_NAME];
        dirty = true;
      }
    }
  }

  if (dirty) {
    settings.mcpServers = mcpServers;
    writeUserConfig(configPath, settings);
  }
  return { path: configPath, updated: dirty };
}
