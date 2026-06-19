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
  compileMethod: vi.fn(() => 'Compiled: Array >> at:'),
  compileClassDefinition: vi.fn(),
  setClassComment: vi.fn(),
  canClassBeWritten: vi.fn(() => true),
}));

import { Uri, FileSystemError, FilePermission, window, languages } from '../__mocks__/vscode';
import { GemStoneFileSystemProvider, buildMethodUri, buildNewMethodUri, buildClassDefinitionUri } from '../gemstoneFileSystemProvider';
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
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
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
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    it('shows a success message with the class name when new-class compiles', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');

      provider.writeFile(uri, encode("Object subclass: 'MyClass'"), { create: true, overwrite: true });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Class created: MyClass');
    });

    it('emits onClassDefinitionCompiled when new-class compiles successfully', async () => {
      const newClassUri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(newClassUri, encode(source), { create: true, overwrite: true });
      await new Promise(resolve => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUri.toString()).toBe(newClassUri.toString());
      expect(event.uri.toString()).toBe('gemstone://1/UserGlobals/MyClass/definition');
      expect(event.isNew).toBe(true);
    });

    it('fires onDidChangeFile with the new-class uri on successful compile', () => {
      const newClassUri = Uri.parse('gemstone://1/UserGlobals/new-class');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      provider.writeFile(newClassUri, encode("Object subclass: 'MyClass'"), { create: true, overwrite: true });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 1, uri: newClassUri }),
        ]),
      );
    });

    it('does not fire onClassDefinitionCompiled and sets a diagnostic when new-class compilation throws', async () => {
      const newClassUri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      vi.mocked(queries.compileClassDefinition).mockImplementationOnce(() => {
        throw new BrowserQueryError('Class not found', 0);
      });
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      expect(() => provider.writeFile(newClassUri, encode(source), { create: true, overwrite: true }))
        .not.toThrow();
      await new Promise(resolve => setImmediate(resolve));

      expect(listener).not.toHaveBeenCalled();
      const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
      expect(collection.set).toHaveBeenCalledWith(
        newClassUri,
        expect.arrayContaining([
          expect.objectContaining({ message: 'Class not found' }),
        ]),
      );
    });


    it('shows a success message with the class name when an existing class definition is saved', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), { create: false, overwrite: true });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Class definition updated for Array');
    });

    it('emits onClassDefinitionCompiled with isNew false when an existing class definition is saved with unchanged name', async () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), { create: false, overwrite: true });
      await new Promise(resolve => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.isNew).toBe(false);
      expect(event.uri.toString()).toBe(uri.toString());
      expect(event.previousUri.toString()).toBe(uri.toString());
    });

    it('emits onClassDefinitionCompiled with the new uri when an existing class definition is saved with a changed name', async () => {
      const previousUri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('RenamedArray');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(previousUri, encode("Object subclass: 'RenamedArray'\n  instVarNames: #()"), { create: false, overwrite: true });
      await new Promise(resolve => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.isNew).toBe(false);
      expect(event.previousUri.toString()).toBe(previousUri.toString());
      expect(event.uri.toString()).toBe('gemstone://1/Globals/RenamedArray/definition');
    });

    it('does not fire onClassDefinitionCompiled and sets a diagnostic when an existing class definition save throws', async () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error', 0);
      });
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      expect(() => provider.writeFile(uri, encode("Object subclass: 'Array'"), { create: false, overwrite: true }))
        .not.toThrow();
      await new Promise(resolve => setImmediate(resolve));

      expect(listener).not.toHaveBeenCalled();
      const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([
          expect.objectContaining({ message: 'Syntax error' }),
        ]),
      );
    });

    it('fires onDidChangeFile with the definition uri on successful compile', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), { create: false, overwrite: true });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 1, uri }),
        ]),
      );
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

      it('syncs the compiled class name after a definition save with unchanged name', () => {
        vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(makeSessionManager(), em as unknown as ExportManager);
        p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/definition'),
          encode("Object subclass: 'Array'\n  instVarNames: #()"), { create: false, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'Globals', 'Array');
      });

      it('syncs the new class name after a definition save that renames the class', () => {
        vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('RenamedArray');
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(makeSessionManager(), em as unknown as ExportManager);
        p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/definition'),
          encode("Object subclass: 'RenamedArray'\n  instVarNames: #()"), { create: false, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'Globals', 'RenamedArray');
      });

      it('syncs the compiled class name after a new-class save', () => {
        vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Foo');
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(makeSessionManager(), em as unknown as ExportManager);
        p.writeFile(
          Uri.parse('gemstone://1/UserGlobals/new-class'),
          encode("Object subclass: 'Foo'\n  inDictionary: UserGlobals"), { create: true, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'UserGlobals', 'Foo');
      });

      it('does not call syncClass when new-class compilation throws', () => {
        vi.mocked(queries.compileClassDefinition).mockImplementationOnce(() => {
          throw new BrowserQueryError('Syntax error', 0);
        });
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(makeSessionManager(), em as unknown as ExportManager);
        expect(() => p.writeFile(
          Uri.parse('gemstone://1/UserGlobals/new-class'),
          encode("Object subclass: 'MyClass'\n  inDictionary: UserGlobals"), { create: true, overwrite: true },
        )).not.toThrow();
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
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');
       provider.writeFile(uri, encode(source), { create: true, overwrite: true });
       expect(queries.compileMethod).toHaveBeenCalledWith(
         expect.anything(), 'Array', false, 'accessing', source, 0,
       );
     });

     it('emits onMethodCompiled event when new-method compiles successfully', async () => {
       const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
       const source = 'foo\n  ^42';
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');
       const listener = vi.fn();
       provider.onMethodCompiled(listener);

       provider.writeFile(newMethodUri, encode(source), { create: true, overwrite: true });
       await new Promise(resolve => setImmediate(resolve));

       expect(listener).toHaveBeenCalledTimes(1);
       const event = listener.mock.calls[0][0];
       expect(event.previousUri.toString()).toBe(newMethodUri.toString());
       expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
       expect(event.isNewMethod).toBe(true);
     });

     it('emits onMethodCompiled with isNewMethod false when an existing method is saved with unchanged selector', async () => {
       const methodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> at:');
       const listener = vi.fn();
       provider.onMethodCompiled(listener);

       provider.writeFile(methodUri, encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true });
       await new Promise(resolve => setImmediate(resolve));

       expect(listener).toHaveBeenCalledTimes(1);
       const event = listener.mock.calls[0][0];
       expect(event.isNewMethod).toBe(false);
       expect(event.uri.toString()).toBe(methodUri.toString());
       expect(event.previousUri.toString()).toBe(methodUri.toString());
     });

     it('emits onMethodCompiled with isNewMethod false when an existing method is saved with a changed selector', async () => {
       const previousUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> newSelector');
       const listener = vi.fn();
       provider.onMethodCompiled(listener);

       provider.writeFile(previousUri, encode('newSelector\n  ^42'), { create: false, overwrite: true });
       await new Promise(resolve => setImmediate(resolve));

       expect(listener).toHaveBeenCalledTimes(1);
       const event = listener.mock.calls[0][0];
       expect(event.isNewMethod).toBe(false);
       expect(event.previousUri.toString()).toBe(previousUri.toString());
       expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/newSelector');
     });

     it('trims trailing whitespace from the selector when building the compiled method uri', async () => {
       const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo ');
       const listener = vi.fn();
       provider.onMethodCompiled(listener);

       provider.writeFile(newMethodUri, encode('foo\n  ^42'), { create: true, overwrite: true });
       await new Promise(resolve => setImmediate(resolve));

       const event = listener.mock.calls[0][0];
       expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
     });

     it('trims leading whitespace from the selector when building the compiled method uri', async () => {
       const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >>  foo');
       const listener = vi.fn();
       provider.onMethodCompiled(listener);

       provider.writeFile(newMethodUri, encode('foo\n  ^42'), { create: true, overwrite: true });
       await new Promise(resolve => setImmediate(resolve));

       const event = listener.mock.calls[0][0];
       expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
     });

     it('does not fire onMethodCompiled after dispose', async () => {
       const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');
       const listener = vi.fn();
       provider.onMethodCompiled(listener);

       provider.dispose();
       provider.writeFile(newMethodUri, encode('foo\n  ^42'), { create: true, overwrite: true });
       await new Promise(resolve => setImmediate(resolve));

       expect(listener).not.toHaveBeenCalled();
     });

     it('sets diagnostic (no throw) when new-method compile result cannot extract selector', () => {
       const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
       const source = 'foo\n  ^42';
       const listener = vi.fn();
       provider.onMethodCompiled(listener);
       vi.mocked(queries.compileMethod).mockReturnValueOnce('Class not found: Array');

       expect(() => provider.writeFile(uri, encode(source), { create: true, overwrite: true }))
         .not.toThrow();
       expect(listener).not.toHaveBeenCalled();
       const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
       expect(collection.set).toHaveBeenCalledWith(
         uri,
         expect.arrayContaining([
           expect.objectContaining({ message: 'Class not found: Array' }),
         ]),
       );
     });

    it('shows success message after compiling a method', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Compiled method Array>>#at:'),
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

describe('buildMethodUri', () => {
  it('uses the gemstone scheme', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 42, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.scheme).toBe('gemstone');
  });

  it('uses the session id as the authority', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 42, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.authority).toBe('42');
  });

  it('places the dictionary name at path segment 1', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'UserGlobals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.path.split('/')[1]).toBe('UserGlobals');
  });

  it('places the class name at path segment 2', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'String', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.path.split('/')[2]).toBe('String');
  });

  it('places "instance" at path segment 3 when isMeta is false', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.path.split('/')[3]).toBe('instance');
  });

  it('places "class" at path segment 3 when isMeta is true', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: true, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.path.split('/')[3]).toBe('class');
  });

  it('places the method category at path segment 4', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.path.split('/')[4]).toBe('accessing');
  });

  it('places the selector at path segment 5', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at:put:', environmentId: 0 });
    expect(uri.path.split('/')[5]).toBe('at:put:');
  });

  it('omits the env query parameter when environmentId is 0', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 });
    expect(uri.query).toBe('');
  });

  it('appends the env query parameter when environmentId is non-zero', () => {
    const uri = buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 2 });
    expect(uri.query).toBe('env=2');
  });

  it('throws when dictName contains a slash', () => {
    expect(() => buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'User/Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 }))
      .toThrow("Dictionary name must not contain '/': User/Globals");
  });

  it('throws when className contains a slash', () => {
    expect(() => buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'My/Class', isMeta: false, category: 'accessing', selector: 'at', environmentId: 0 }))
      .toThrow("Class name must not contain '/': My/Class");
  });

  it('throws when category contains a slash', () => {
    expect(() => buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing/stuff', selector: 'at', environmentId: 0 }))
      .toThrow("Method category name must not contain '/': accessing/stuff");
  });

  it('throws when selector contains a slash', () => {
    expect(() => buildMethodUri({ kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false, category: 'accessing', selector: 'foo/bar', environmentId: 0 }))
      .toThrow("Selector must not contain '/': foo/bar");
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

describe('buildClassDefinitionUri', () => {
  it('uses the gemstone scheme', () => {
    const uri = buildClassDefinitionUri(42, 'Globals', 'Array');
    expect(uri.scheme).toBe('gemstone');
  });

  it('uses the session id as the authority', () => {
    const uri = buildClassDefinitionUri(42, 'Globals', 'Array');
    expect(uri.authority).toBe('42');
  });

  it('places the dictionary name at path segment 1', () => {
    const uri = buildClassDefinitionUri(1, 'UserGlobals', 'Array');
    expect(uri.path.split('/')[1]).toBe('UserGlobals');
  });

  it('places the class name at path segment 2', () => {
    const uri = buildClassDefinitionUri(1, 'Globals', 'MyClass');
    expect(uri.path.split('/')[2]).toBe('MyClass');
  });

  it('places "definition" at path segment 3', () => {
    const uri = buildClassDefinitionUri(1, 'Globals', 'Array');
    expect(uri.path.split('/')[3]).toBe('definition');
  });

  it('throws when dictName contains a slash', () => {
    expect(() => buildClassDefinitionUri(1, 'User/Globals', 'Array'))
      .toThrow("Dictionary name must not contain '/': User/Globals");
  });

  it('throws when className contains a slash', () => {
    expect(() => buildClassDefinitionUri(1, 'Globals', 'My/Class'))
      .toThrow("Class name must not contain '/': My/Class");
  });
});
