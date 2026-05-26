import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('fs');
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  claudeDesktopConfigPath,
  defaultSocketPath,
  MCP_SERVER_NAME,
  proxyScriptPath,
  writeClaudeDesktopMcpConfig,
} from '../mcpSocketServer';
import {extensionPathFrom} from "../extensionPath";

function withPlatform(platform: string, fn: () => void) {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  }
}

describe('defaultSocketPath', () => {
  it('returns mcp.sock in the extension folder on darwin', () => {
    withPlatform('darwin', () => {
      expect(defaultSocketPath()).toBe(extensionPathFrom('mcp.sock'));
    });
  });

  it('returns mcp.sock in the extension folder on linux', () => {
    withPlatform('linux', () => {
      expect(defaultSocketPath()).toBe(extensionPathFrom('mcp.sock'));
    });
  });

  it('returns a named pipe on win32', () => {
    withPlatform('win32', () => {
      expect(defaultSocketPath()).toBe('\\\\.\\pipe\\jasper-mcp');
    });
  });

  it('is invariant across calls (no workspace input)', () => {
    expect(defaultSocketPath()).toBe(defaultSocketPath());
  });
});

describe('proxyScriptPath', () => {
  it('resolves to mcp-server/out/index.js inside the extension', () => {
    expect(proxyScriptPath('/ext')).toMatch(/mcp-server[\\/]+out[\\/]+index\.js$/);
  });
});

describe('claudeDesktopConfigPath', () => {
  it('resolves the macOS Application Support path', () => {
    withPlatform('darwin', () => {
      expect(claudeDesktopConfigPath()).toBe(
        path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      );
    });
  });

  it('resolves the Windows %APPDATA% path', () => {
    const origAppData = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
    try {
      withPlatform('win32', () => {
        expect(claudeDesktopConfigPath()).toBe(
          path.join('C:\\Users\\me\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
        );
      });
    } finally {
      if (origAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = origAppData;
    }
  });

  it('falls back to ~/.config on Linux', () => {
    withPlatform('linux', () => {
      expect(claudeDesktopConfigPath()).toBe(
        path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
      );
    });
  });
});

// ── writeClaudeDesktopMcpConfig (mocked fs) ──────────────────────────────────

describe('writeClaudeDesktopMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.mkdirSync).mockClear();
  });

  it('writes a single global gemstone entry', () => {
    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers[MCP_SERVER_NAME].command).toBe('node');
    expect(written.mcpServers[MCP_SERVER_NAME].args).toContain('--proxy-socket');
    expect(written.mcpServers[MCP_SERVER_NAME].args).toContain('/tmp/socket.sock');
  });

  it('returns the platform-specific Desktop config path', () => {
    withPlatform('darwin', () => {
      const returned = writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');
      expect(returned).toBe(claudeDesktopConfigPath());
    });
  });

  it('preserves unrelated mcpServers entries', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        filesystem: { command: 'mcp-fs' },
        notion: { command: 'mcp-notion' },
      },
    }));

    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.filesystem).toEqual({ command: 'mcp-fs' });
    expect(written.mcpServers.notion).toEqual({ command: 'mcp-notion' });
    expect(written.mcpServers.gemstone).toBeDefined();
  });

  it('preserves top-level siblings of mcpServers', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      globalShortcut: 'Ctrl+Space',
      mcpServers: {},
    }));

    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.globalShortcut).toBe('Ctrl+Space');
  });

  it('does not rewrite when the entry is already correct', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        gemstone: {
          command: 'node',
          args: [proxyScriptPath('/ext'), '--proxy-socket', '/tmp/socket.sock'],
        },
      },
    }));

    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rewrites when the socket path has changed', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        gemstone: {
          command: 'node',
          args: [proxyScriptPath('/ext'), '--proxy-socket', '/tmp/OLD.sock'],
        },
      },
    }));

    writeClaudeDesktopMcpConfig('/ext', '/tmp/NEW.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.gemstone.args).toContain('/tmp/NEW.sock');
  });

  it('migrates legacy gemstone-<hash> entries into the single global entry', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        'gemstone-abcdef0123': { command: 'node', args: ['stale'] },
        'gemstone-fedcba9876': { command: 'node', args: ['also-stale'] },
        filesystem: { command: 'mcp-fs' },
      },
    }));

    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers['gemstone-abcdef0123']).toBeUndefined();
    expect(written.mcpServers['gemstone-fedcba9876']).toBeUndefined();
    expect(written.mcpServers.gemstone).toBeDefined();
    expect(written.mcpServers.filesystem).toEqual({ command: 'mcp-fs' });
  });

  it('rewrites when only the legacy cleanup applies, even if the new entry is current', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        gemstone: {
          command: 'node',
          args: [proxyScriptPath('/ext'), '--proxy-socket', '/tmp/socket.sock'],
        },
        'gemstone-abcdef0123': { command: 'node', args: ['stale'] },
      },
    }));

    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('creates the Claude config directory if missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      return !s.endsWith('claude_desktop_config.json') && !s.endsWith('Claude');
    });

    writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringMatching(/Claude$/),
      { recursive: true },
    );
  });

  it('recovers from an unreadable config by starting fresh (without throwing)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not-valid-json');

    expect(() => writeClaudeDesktopMcpConfig('/ext', '/tmp/socket.sock')).not.toThrow();

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.gemstone).toBeDefined();
  });
});

