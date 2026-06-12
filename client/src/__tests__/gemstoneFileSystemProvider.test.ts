import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

// Mock browserQueries
vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
  getMethodSource: vi.fn(() => 'at: index\n  ^self basicAt: index'),
  getClassDefinition: vi.fn(() => "Object subclass: 'Array'\n  instVarNames: #()"),
  getClassComment: vi.fn(() => 'An ordered collection.'),
  compileMethod: vi.fn(() => 1n),
  compileClassDefinition: vi.fn(),
  setClassComment: vi.fn(),
  canClassBeWritten: vi.fn(() => true),
}));

import { Uri, FileSystemError, FilePermission, window, languages } from '../__mocks__/vscode';
import { GemStoneFileSystemProvider, buildNewMethodUri } from '../gemstoneFileSystemProvider';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { BrowserQueryError } from '../browserQueries';
import type { ExportManager } from '../exportManager';

function makeSession(id = 1, gs_user = 'DataCurator') {
  return { id, gci: {}, handle: {}, login: { label: 'Test', gs_user }, stoneVersion: '3.7.2' };
}

function makeSessionManager(gs_user = 'DataCurator') {
  const session = makeSession(1, gs_user);
  return {
    getSessions: vi.fn(() => [session]),
    getSession: vi.fn((id: number) => id === 1 ? session : undefined),
  } as unknown as SessionManager;
}

describe('GemStoneFileSystemProvider', () => {
  let provider: GemStoneFileSystemProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GemStoneFileSystemProvider(makeSessionManager());
  });

  describe('stat', () => {
    it('returns a file stat', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.type).toBe(1); // FileType.File
      expect(stat.ctime).toBe(0);
      expect(stat.mtime).toBeGreaterThan(0);
    });

    it('calls canClassBeWritten for method URIs', () => {
      provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(queries.canClassBeWritten).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'Array');
    });

    it('returns writable when canClassBeWritten returns true', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });

    it('returns read-only when canClassBeWritten returns false', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('returns read-only for class definitions when canClassBeWritten returns false', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/definition'));
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('returns read-only for class comments when canClassBeWritten returns false', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/comment'));
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('allows editing when canClassBeWritten throws (e.g., session busy)', () => {
      vi.mocked(queries.canClassBeWritten).mockImplementation(() => { throw new BrowserQueryError('Session busy'); });
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });

    it('always returns writable for new-class URIs without calling canClassBeWritten', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/UserGlobals/new-class'));
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('always returns writable for new-method URIs without calling canClassBeWritten', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method'));
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('returns writable when session is not found', () => {
      const mgr = { getSessions: vi.fn(() => []), getSession: vi.fn(() => undefined) } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      const stat = p.stat(Uri.parse('gemstone://99/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });
  });

  describe('readFile', () => {
    it('reads a method source', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toBe('at: index\n  ^self basicAt: index');
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }), 'Array', false, 'at:', 0,
      );
    });

    it('reads a class-side method source', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', true, 'new:', 0,
      );
    });

    it('reads a method source with environment from query param', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=2');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, '__len__', 2,
      );
    });

    it('reads a class definition', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("Object subclass: 'Array'");
      expect(queries.getClassDefinition).toHaveBeenCalledWith(
        expect.anything(), 'Array',
      );
    });

    it('reads a class comment', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toBe('An ordered collection.');
      expect(queries.getClassComment).toHaveBeenCalledWith(
        expect.anything(), 'Array',
      );
    });

    it('returns new-class template with dictionary name', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("Object subclass: 'NameOfClass'");
      expect(content).toContain('inDictionary: UserGlobals');
    });

    it('returns new-method template', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain('messageSelector');
      expect(content).toContain('"comment"');
    });

    it('throws FileNotFound for invalid URI', () => {
      const uri = Uri.parse('gemstone://1/too/few');
      expect(() => provider.readFile(uri)).toThrow();
    });
  });

  describe('writeFile', () => {
    const encode = (s: string) => new TextEncoder().encode(s);

    it('compiles a method on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'accessing', 'at: index\n  ^self basicAt: index', 0,
      );
    });

    it('compiles a method with environment on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=1');
      provider.writeFile(uri, encode('__len__\n  ^self size'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'python', '__len__\n  ^self size', 1,
      );
    });

    it('compiles a class definition on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const source = "Object subclass: 'Array'\n  instVarNames: #()";
      provider.writeFile(uri, encode(source), { create: false, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    it('sets class comment on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment');
      provider.writeFile(uri, encode('Updated comment'), { create: false, overwrite: true });
      expect(queries.setClassComment).toHaveBeenCalledWith(
        expect.anything(), 'Array', 'Updated comment',
      );
    });

    it('compiles new-class on save', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    describe('mirror sync after save', () => {
      const makeExportManager = () =>
        ({ syncClass: vi.fn(() => Promise.resolve()), scheduleRefresh: vi.fn() });

      it('re-files-out the edited class after a method save', () => {
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(makeSessionManager(), em as unknown as ExportManager);
        p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'),
          encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'Globals', 'Array');
      });

      it('debounced-refreshes after a new-class save (no class name in the URI)', () => {
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(makeSessionManager(), em as unknown as ExportManager);
        p.writeFile(
          Uri.parse('gemstone://1/UserGlobals/new-class'),
          encode("Object subclass: 'Foo'\n  inDictionary: UserGlobals"), { create: true, overwrite: true },
        );
        expect(em.scheduleRefresh).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
        expect(em.syncClass).not.toHaveBeenCalled();
      });

      it('does not throw when no export manager is wired', () => {
        const p = new GemStoneFileSystemProvider(makeSessionManager());
        expect(() => p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'),
          encode('at: i\n  ^1'), { create: false, overwrite: true },
        )).not.toThrow();
      });
    });

    it('compiles new-method on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const source = 'foo\n  ^42';
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'accessing', source, 0,
      );
    });

    it('shows success message after compiling a method', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Compiled Array>>#at:'),
      );
    });

    it('shows success message for class-side method compilation', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.writeFile(uri, encode('new: size\n  ^self basicNew: size'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', true, 'creation', 'new: size\n  ^self basicNew: size', 0,
      );
    });

    it('fires onDidChangeFile event on success', () => {
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 1, uri }),
        ]),
      );
    });
  });

  describe('writeFile diagnostics', () => {
    const encode = (s: string) => new TextEncoder().encode(s);

    function getDiagCollection() {
      // The provider creates the collection during field initialization (constructor),
      // which runs after vi.clearAllMocks() in the outer beforeEach.
      return vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
    }

    it('does not throw on BrowserQueryError — shows diagnostic instead', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error near line 3, column 5', 100);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      expect(() => {
        provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });
      }).not.toThrow();
    });

    it('sets a diagnostic on compile failure', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error near line 3, column 5', 100);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([
          expect.objectContaining({ message: 'Syntax error near line 3, column 5' }),
        ]),
      );
    });

    it('parses line number from error message for the diagnostic range', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Error at line 5: unexpected token', 0);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      const [[, diags]] = (collection.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(diags[0].range.start.line).toBe(4); // line 5 → 0-indexed = 4
    });

    it('uses line 0 when no line number in the error message', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Generic compile error', 0);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      const [[, diags]] = (collection.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(diags[0].range.start.line).toBe(0);
    });

    it('clears diagnostics on successful compile', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      expect(collection.delete).toHaveBeenCalledWith(uri);
      expect(collection.set).not.toHaveBeenCalled();
    });

    it('rethrows non-BrowserQueryError exceptions', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new Error('Unexpected internal error');
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      expect(() => {
        provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });
      }).toThrow('Unexpected internal error');
    });
  });

  describe('session lookup', () => {
    it('throws Unavailable when session is gone', () => {
      const mgr = {
        getSessions: vi.fn(() => []),
        getSession: vi.fn(() => undefined),
      } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      const uri = Uri.parse('gemstone://99/Globals/Array/definition');
      expect(() => p.readFile(uri)).toThrow();
    });
  });

  describe('URI parsing', () => {
    it('parses method URI with special characters', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3Aput%3A');
      const content = provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'at:put:', 0,
      );
    });

    it('parses class side correctly', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', true, 'new:', 0,
      );
    });

    it('distinguishes new-method from regular method', () => {
      // new-method URI
      const uri1 = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const content1 = new TextDecoder().decode(provider.readFile(uri1));
      expect(content1).toContain('messageSelector');

      // regular method called "size"
      const uri2 = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      provider.readFile(uri2);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'size', 0,
      );
    });
  });
});

describe('buildNewMethodUri', () => {
  it('uses the gemstone scheme', () => {
    const uri = buildNewMethodUri(42, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.scheme).toBe('gemstone');
  });

  it('uses the session id as the authority', () => {
    const uri = buildNewMethodUri(42, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.authority).toBe('42');
  });

  it('places the dictionary name at path segment 1', () => {
    const uri = buildNewMethodUri(1, 'UserGlobals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[1]).toBe('UserGlobals');
  });

  it('places the class name at path segment 2', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[2]).toBe('Array');
  });

  it('places "instance" at path segment 3 when isMeta is false', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[3]).toBe('instance');
  });

  it('places "class" at path segment 3 when isMeta is true', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', true, 'accessing', 0);
    expect(uri.path.split('/')[3]).toBe('class');
  });

  it('places the method category at path segment 4', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[4]).toBe('accessing');
  });

  it('omits the env query parameter when environmentId is 0', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.query).toBe('');
  });

  it('appends the env query parameter when environmentId is non-zero', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 2);
    expect(uri.query).toBe('env=2');
  });

  it('throws when dictName contains a slash', () => {
    expect(() => buildNewMethodUri(1, 'User/Globals', 'Array', false, 'accessing', 0))
      .toThrow("Dictionary name must not contain '/': User/Globals");
  });

  it('throws when className contains a slash', () => {
    expect(() => buildNewMethodUri(1, 'Globals', 'My/Class', false, 'accessing', 0))
      .toThrow("Class name must not contain '/': My/Class");
  });

  it('throws when category contains a slash', () => {
    expect(() => buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing/stuff', 0))
      .toThrow("Method category name must not contain '/': accessing/stuff");
  });
});
