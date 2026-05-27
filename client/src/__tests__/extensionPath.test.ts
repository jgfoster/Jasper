import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs');

import * as fs from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { extensionPathFrom, initializeExtensionFolder } from '../extensionPath';

const expectedFolder = path.join(os.homedir(), '.jasper');

describe('extensionPathFrom', () => {
  it('joins paths under ~/.jasper', () => {
    expect(extensionPathFrom('mcp.sock')).toBe(path.join(expectedFolder, 'mcp.sock'));
  });

  it('supports multiple path segments', () => {
    expect(extensionPathFrom('sub', 'file.json')).toBe(
      path.join(expectedFolder, 'sub', 'file.json'),
    );
  });

  it('returns the folder itself when called with no arguments', () => {
    expect(extensionPathFrom()).toBe(expectedFolder);
  });
});

describe('initializeExtensionFolder', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
  });

  it('creates the extension folder recursively when it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    initializeExtensionFolder();

    expect(fs.existsSync).toHaveBeenCalledWith(expectedFolder);
    expect(fs.mkdirSync).toHaveBeenCalledWith(expectedFolder, { recursive: true });
  });

  it('does not create the folder when it already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    initializeExtensionFolder();

    expect(fs.existsSync).toHaveBeenCalledWith(expectedFolder);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('propagates errors from mkdirSync so activation can surface them', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const permissionError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw permissionError;
    });

    expect(() => initializeExtensionFolder()).toThrow(permissionError);
  });
});
