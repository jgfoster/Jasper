import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MCP_SERVER_NAME, proxyScriptPath } from './mcpSocketServer';

/**
 * Claude Code reads its MCP server list from `~/.claude.json`. Entries under
 * the top-level `mcpServers` key are user-scope and visible from every
 * directory; entries under `projects.<cwd>.mcpServers` are project-scope
 * (which is what `claude mcp add` writes). Jasper now writes only the
 * user-scope entry so the gemstone tools are available everywhere — same
 * model as Anthropic's hosted Gmail/Drive/Calendar connectors.
 *
 * On every activation we also strip any project-scope `gemstone` entries
 * left over from earlier Jasper versions that shelled out to `claude mcp
 * add`; those entries point at workspace-hashed sockets that no longer
 * exist.
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
    return { __unreadable__: true } as ClaudeCodeUserConfig;
  }
}

function writeUserConfig(configPath: string, settings: ClaudeCodeUserConfig): void {
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Idempotently write the user-scope `gemstone` MCP entry to `~/.claude.json`
 * and remove any stale project-scope entries with the same name. Returns the
 * config path plus whether the file was actually updated.
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

  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  let dirty = false;
  if (JSON.stringify(mcpServers[MCP_SERVER_NAME]) !== JSON.stringify(desired)) {
    mcpServers[MCP_SERVER_NAME] = desired;
    dirty = true;
  }

  if (settings.projects) {
    for (const proj of Object.values(settings.projects)) {
      const projMcp = proj?.mcpServers as Record<string, unknown> | undefined;
      if (projMcp && MCP_SERVER_NAME in projMcp) {
        delete projMcp[MCP_SERVER_NAME];
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
