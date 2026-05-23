import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('fs');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  claudeCodeUserConfigPath,
  writeClaudeCodeUserMcpConfig,
} from '../claudeCodeUserMcpConfig';
import { proxyScriptPath } from '../mcpSocketServer';

const desiredEntry = (extPath: string, sockPath: string) => ({
  type: 'stdio',
  command: 'node',
  args: [proxyScriptPath(extPath), '--proxy-socket', sockPath],
  env: {},
});

describe('claudeCodeUserConfigPath', () => {
  it('resolves to ~/.claude.json', () => {
    expect(claudeCodeUserConfigPath()).toBe(path.join(os.homedir(), '.claude.json'));
  });
});

describe('writeClaudeCodeUserMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockClear();
  });

  it('writes a single user-scope gemstone entry under top-level mcpServers', () => {
    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    expect(result.skipped).toBeUndefined();
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.gemstone).toEqual(desiredEntry('/ext', '/tmp/socket.sock'));
  });

  it('does not rewrite when the entry is already correct', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { gemstone: desiredEntry('/ext', '/tmp/socket.sock') },
    }));

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rewrites when the proxy path has changed (e.g., extension version bump)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { gemstone: desiredEntry('/OLD-ext', '/tmp/socket.sock') },
    }));

    const result = writeClaudeCodeUserMcpConfig('/NEW-ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.gemstone.args[0]).toContain('NEW-ext');
  });

  it('preserves unrelated top-level mcpServers entries', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        'claude-context': { command: 'other' },
      },
    }));

    writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers['claude-context']).toEqual({ command: 'other' });
    expect(written.mcpServers.gemstone).toBeDefined();
  });

  it('preserves unrelated top-level keys like projects', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      userID: 'abc-123',
      projects: { '/some/path': { history: ['a', 'b'] } },
    }));

    writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.userID).toBe('abc-123');
    expect(written.projects['/some/path'].history).toEqual(['a', 'b']);
  });

  it('removes legacy project-scope gemstone entries (from previous `claude mcp add`)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      projects: {
        '/Users/me/Grail': {
          mcpServers: {
            gemstone: { command: 'node', args: ['stale-proxy'] },
            'other-mcp': { command: 'keep-me' },
          },
        },
        '/Users/me/WebGS': {
          mcpServers: {
            gemstone: { command: 'node', args: ['also-stale'] },
          },
        },
        '/Users/me/Untouched': {
          history: ['something'],
        },
      },
    }));

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.projects['/Users/me/Grail'].mcpServers.gemstone).toBeUndefined();
    expect(written.projects['/Users/me/Grail'].mcpServers['other-mcp']).toEqual({ command: 'keep-me' });
    expect(written.projects['/Users/me/WebGS'].mcpServers.gemstone).toBeUndefined();
    expect(written.projects['/Users/me/Untouched'].history).toEqual(['something']);
  });

  it('rewrites when only the legacy-project cleanup applies', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { gemstone: desiredEntry('/ext', '/tmp/socket.sock') },
      projects: {
        '/Users/me/Grail': {
          mcpServers: { gemstone: { command: 'node', args: ['stale'] } },
        },
      },
    }));

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('skips with "missing" when ~/.claude.json does not exist (does not create it)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.skipped).toBe('missing');
    expect(result.updated).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('skips with "unreadable" when the file cannot be parsed (does not clobber)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('this-is-not-json');

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.skipped).toBe('unreadable');
    expect(result.updated).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
