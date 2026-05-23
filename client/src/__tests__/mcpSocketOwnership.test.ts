/**
 * Owner/passive lifecycle tests for {@link McpSocketServer}. Uses real
 * Unix sockets in `os.tmpdir()`, so it intentionally does NOT mock `fs`.
 * The mocked-fs tests for the Claude Desktop config writer live in
 * mcpSocketServer.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { McpSocketServer } from '../mcpSocketServer';

const tmpSocketPath = () =>
  path.join(os.tmpdir(), `jasper-mcp-test-${crypto.randomBytes(6).toString('hex')}.sock`);

describe('McpSocketServer ownership', () => {
  let servers: McpSocketServer[] = [];

  beforeEach(() => {
    servers = [];
  });

  afterEach(async () => {
    for (const s of servers) {
      await s.dispose().catch(() => undefined);
    }
  });

  it('the first server to start becomes the owner and creates the socket file', async () => {
    const socketPath = tmpSocketPath();
    const server = new McpSocketServer({ getSession: () => undefined, socketPath });
    servers.push(server);

    const isOwner = await server.start();

    expect(isOwner).toBe(true);
    expect(server.isOwner).toBe(true);
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it('a second server on the same path is passive (EADDRINUSE)', async () => {
    const socketPath = tmpSocketPath();

    const first = new McpSocketServer({ getSession: () => undefined, socketPath });
    servers.push(first);
    expect(await first.start()).toBe(true);

    const second = new McpSocketServer({ getSession: () => undefined, socketPath });
    servers.push(second);
    expect(await second.start()).toBe(false);
    expect(second.isOwner).toBe(false);
  });

  it('a stale socket file (no listener) is reclaimed by the next start', async () => {
    const socketPath = tmpSocketPath();
    // Simulate a previous owner that crashed without unlinking the file.
    fs.writeFileSync(socketPath, '');

    const server = new McpSocketServer({ getSession: () => undefined, socketPath });
    servers.push(server);

    expect(await server.start()).toBe(true);
  });

  it('dispose() removes the socket file only when this instance was the owner', async () => {
    const socketPath = tmpSocketPath();

    const first = new McpSocketServer({ getSession: () => undefined, socketPath });
    await first.start();
    expect(first.isOwner).toBe(true);

    const second = new McpSocketServer({ getSession: () => undefined, socketPath });
    await second.start();
    expect(second.isOwner).toBe(false);

    // Passive dispose must leave the file alone — the real owner still uses it.
    await second.dispose();
    expect(fs.existsSync(socketPath)).toBe(true);

    // Owner dispose unlinks.
    await first.dispose();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('creates the parent directory if missing', async () => {
    const dir = path.join(os.tmpdir(), `jasper-mcp-dir-${crypto.randomBytes(6).toString('hex')}`);
    const socketPath = path.join(dir, 'mcp.sock');
    expect(fs.existsSync(dir)).toBe(false);

    const server = new McpSocketServer({ getSession: () => undefined, socketPath });
    servers.push(server);

    expect(await server.start()).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);

    // Clean up the dir after the server is disposed.
    await server.dispose();
    try {
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  });
});
