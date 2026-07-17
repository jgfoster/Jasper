import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

import { ActiveSession } from '../sessionManager';
import { executeFetchString } from '../browserQueries';
import {
  installMcpServer,
  isMcpServerInstalled,
  imageHasGrail,
  supportsMcpServer,
  MCP_SERVER_FILES,
  MCP_SERVER_MIN_VERSION,
  GRAIL_FILE,
} from '../mcpServerInstall';

const executeFetchStringMock = executeFetchString as ReturnType<typeof vi.fn>;

const PAYLOAD_DIR = '/payload/mcp-server';

// Default: gem can read everything, no Grail in the image, Published already
// exists, every file-in succeeds, verification passes.
function happyPath(_s: unknown, _label: string, code: string): string {
  if (code.includes('existsOnServer')) return 'true';
  if (code.includes('resolveSymbol: #ModuleAst')) return 'false';
  if (code.includes('canUnderstand: #runOnPort:')) return 'true';
  if (code.includes('GsFileIn fromPath')) return 'ok';
  if (code.includes('#Published')) return 'exists';
  return 'nil';
}

function createMockSession() {
  const commit = vi.fn(() => ({ success: true, err: { number: 0 } }));
  const abort = vi.fn(() => ({ success: true, err: { number: 0 } }));
  const session = {
    id: 1,
    handle: {},
    gci: { GciTsCommit: commit, GciTsAbort: abort },
  } as unknown as ActiveSession;
  return { session, commit, abort };
}

function filedInFileFrom(code: string): string | undefined {
  if (!code.includes('GsFileIn fromPath')) return undefined;
  return [...MCP_SERVER_FILES, GRAIL_FILE].find((f) => code.includes(f));
}

describe('supportsMcpServer', () => {
  it('accepts the supported minimum version', () => {
    expect(supportsMcpServer(MCP_SERVER_MIN_VERSION)).toBe(true);
  });

  it.each(['3.6.1', '3.6.0', '3.6', '3.5.0', '2.4.5'])(
    'rejects %s (below the supported minimum)',
    (version) => {
      expect(supportsMcpServer(version)).toBe(false);
    },
  );

  it('accepts later releases via semantic comparison', () => {
    expect(supportsMcpServer('3.6.3')).toBe(true);
    expect(supportsMcpServer('3.7.0')).toBe(true);
    expect(supportsMcpServer('3.7.10')).toBe(true);
  });

  it('accepts a later major release', () => {
    expect(supportsMcpServer('4.0.0')).toBe(true);
  });

  it('accepts a short major.minor future version like "4.0"', () => {
    expect(supportsMcpServer('4.0')).toBe(true);
  });

  it('accepts a raw GciTsVersion string with a trailing build suffix', () => {
    expect(supportsMcpServer('3.6.2 build 64bit')).toBe(true);
    expect(supportsMcpServer('3.7.0, gss64')).toBe(true);
  });

  it('honors the gate on a version with a trailing suffix that is below the minimum', () => {
    expect(supportsMcpServer('3.6.1 build 64bit')).toBe(false);
  });

  it('rejects a missing or unparseable version rather than throwing', () => {
    expect(supportsMcpServer(undefined)).toBe(false);
    expect(supportsMcpServer('')).toBe(false);
    expect(supportsMcpServer('not-a-version')).toBe(false);
  });
});

describe('installMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFetchStringMock.mockImplementation(happyPath);
  });

  it('files in every runtime file server-side, commits once, and verifies', async () => {
    const { session, commit } = createMockSession();

    const result = await installMcpServer(session, PAYLOAD_DIR);

    expect(result.success).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.withGrail).toBe(false);
    expect(result.filedIn).toEqual([...MCP_SERVER_FILES]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('files the payload in the loader dependency order', async () => {
    const { session } = createMockSession();
    const order: string[] = [];
    executeFetchStringMock.mockImplementation((s, label, code: string) => {
      const f = filedInFileFrom(code);
      if (f) order.push(f);
      return happyPath(s, label, code);
    });

    await installMcpServer(session, PAYLOAD_DIR);

    expect(order).toEqual([...MCP_SERVER_FILES]);
  });

  it('ensures the Published dictionary before filing any class in', async () => {
    const { session } = createMockSession();
    const events: string[] = [];
    executeFetchStringMock.mockImplementation((s, label, code: string) => {
      if (code.includes('#Published')) events.push('published');
      if (code.includes('GsFileIn fromPath')) events.push('filein');
      return happyPath(s, label, code);
    });

    await installMcpServer(session, PAYLOAD_DIR);

    expect(events[0]).toBe('published');
    expect(events).toContain('filein');
  });

  it('files each file in with a single server-side GsFileIn call', async () => {
    const { session } = createMockSession();

    await installMcpServer(session, PAYLOAD_DIR);

    const fileInCalls = executeFetchStringMock.mock.calls.filter(
      (c) => String(c[2]).includes('GsFileIn fromPath'),
    );
    expect(fileInCalls).toHaveLength(MCP_SERVER_FILES.length);
  });

  it('files every file in as #serverUtf8File so non-ASCII payload bytes survive Unicode-mode stones', async () => {
    const { session } = createMockSession();

    await installMcpServer(session, PAYLOAD_DIR);

    const fileInCalls = executeFetchStringMock.mock.calls
      .map((c) => String(c[2]))
      .filter((code) => code.includes('GsFileIn fromPath'));
    for (const code of fileInCalls) {
      expect(code).toContain('on: #serverUtf8File to: nil');
    }
  });

  it('also files in the Grail subclass when the image has Grail', async () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation((s, label, code: string) => {
      if (code.includes('resolveSymbol: #ModuleAst')) return 'true';
      return happyPath(s, label, code);
    });

    const result = await installMcpServer(session, PAYLOAD_DIR);

    expect(result.withGrail).toBe(true);
    expect(result.filedIn).toEqual([...MCP_SERVER_FILES, GRAIL_FILE]);
  });

  it('fails clearly without committing when the gem cannot read the payload', async () => {
    const { session, commit, abort } = createMockSession();
    executeFetchStringMock.mockImplementation((s, label, code: string) => {
      if (code.includes('existsOnServer')) return 'false';
      return happyPath(s, label, code);
    });

    const result = await installMcpServer(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot read');
    expect(commit).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('stops at the first failing file, aborts, and commits nothing', async () => {
    const { session, commit, abort } = createMockSession();
    const failing = MCP_SERVER_FILES[1];
    executeFetchStringMock.mockImplementation((s, label, code: string) => {
      if (code.includes('GsFileIn fromPath') && code.includes(failing)) {
        throw new Error('compile failed');
      }
      return happyPath(s, label, code);
    });

    const result = await installMcpServer(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.failedFile).toBe(failing);
    expect(result.filedIn).toEqual([MCP_SERVER_FILES[0]]);
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('reports failure and aborts when the commit is refused', async () => {
    const { session, abort } = createMockSession();
    session.gci.GciTsCommit = vi.fn(() => ({
      success: false,
      err: { number: 4007, message: 'commit disallowed' },
    })) as unknown as ActiveSession['gci']['GciTsCommit'];

    const result = await installMcpServer(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.message).toContain('commit disallowed');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('flags an incomplete install when verification fails after commit', async () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation((s, label, code: string) => {
      if (code.includes('canUnderstand: #runOnPort:')) return 'false';
      return happyPath(s, label, code);
    });

    const result = await installMcpServer(session, PAYLOAD_DIR);

    expect(result.committed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.success).toBe(false);
  });

  it('reports incremental progress as it works', async () => {
    const { session } = createMockSession();
    const steps: string[] = [];

    await installMcpServer(session, PAYLOAD_DIR, (message) => steps.push(message));

    expect(steps.some((m) => m.includes('GsMcpServer.gs'))).toBe(true);
    expect(steps.some((m) => m.toLowerCase().includes('published'))).toBe(true);
    expect(steps.some((m) => m.toLowerCase().includes('committing'))).toBe(true);
  });
});

describe('isMcpServerInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is true when GsMcpServer resolves and understands runOnPort:', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockReturnValue('true');

    expect(isMcpServerInstalled(session)).toBe(true);
  });

  it('is false when the probe reports the server is absent', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockReturnValue('false');

    expect(isMcpServerInstalled(session)).toBe(false);
  });

  it('is false when the probe itself raises', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(isMcpServerInstalled(session)).toBe(false);
  });
});

describe('imageHasGrail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is true when ModuleAst resolves in the image', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockReturnValue('true');

    expect(imageHasGrail(session)).toBe(true);
  });

  it('is false when ModuleAst does not resolve', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockReturnValue('false');

    expect(imageHasGrail(session)).toBe(false);
  });

  it('is false when the probe itself raises', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(imageHasGrail(session)).toBe(false);
  });
});
