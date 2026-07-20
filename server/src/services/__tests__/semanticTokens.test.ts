import { describe, it, expect } from 'vitest';
import { DocumentManager, DocumentFormat } from '../../utils/documentManager';
import { ScopeAnalyzer } from '../../utils/scopeAnalyzer';
import {
  collectSemanticTokens,
  encodeSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
} from '../semanticTokens';

function typeIndex(name: string): number {
  return SEMANTIC_TOKEN_TYPES.indexOf(name);
}

// Mirror the server's semanticTokens handler exactly, including the per-region
// lineOffset and the emitPattern flag (false for synthetic 'smalltalk-code'
// wrappers) so tests exercise production behavior.
function getTokens(source: string, uri = 'test://test', format: DocumentFormat = 'topaz') {
  const dm = new DocumentManager();
  const doc = dm.update(uri, 1, source, format);

  const allTokens: ReturnType<typeof collectSemanticTokens> = [];
  const analyzer = new ScopeAnalyzer();

  for (const pr of doc.parsedRegions) {
    if (!pr.ast) continue;
    const lineOffset = pr.region.startLine - (pr.region.kind === 'smalltalk-code' ? 1 : 0);
    const scopeRoot = analyzer.analyze(pr.ast);
    allTokens.push(
      ...collectSemanticTokens(
        pr.ast,
        pr.tokens,
        lineOffset,
        scopeRoot,
        pr.region.selectorColumnOffset ?? 0,
        pr.region.kind !== 'smalltalk-code',
      ),
    );
  }

  return allTokens;
}

function getEncodedTokens(source: string): number[] {
  return encodeSemanticTokens(getTokens(source));
}

describe('Semantic Tokens', () => {
  describe('method pattern', () => {
    it('marks unary selector as method+declaration', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ 42\n%');
      const selectorToken = tokens.find((t) => t.tokenType === typeIndex('method'));
      expect(selectorToken).toBeDefined();
      expect(selectorToken!.modifiers & 1).toBe(1); // declaration
    });

    it('marks keyword pattern parameters as parameter+declaration+readonly', () => {
      const tokens = getTokens('method: Foo\nat: index put: value\n  ^ index\n%');
      const paramTokens = tokens.filter(
        (t) => t.tokenType === typeIndex('parameter') && (t.modifiers & 1) === 1,
      );
      expect(paramTokens.length).toBeGreaterThanOrEqual(2); // index, value
    });
  });

  describe('temporaries', () => {
    it('marks temporary declarations as variable+declaration', () => {
      const tokens = getTokens('method: Foo\nfoo\n  | x |\n  x := 42.\n  ^ x\n%');
      const tempDecls = tokens.filter(
        (t) => t.tokenType === typeIndex('variable') && (t.modifiers & 1) === 1,
      );
      expect(tempDecls).toHaveLength(1);
    });
  });

  describe('variable usage', () => {
    it('marks temporary usage as variable', () => {
      const tokens = getTokens('method: Foo\nfoo\n  | x |\n  x := 1.\n  ^ x\n%');
      const varUses = tokens.filter(
        (t) => t.tokenType === typeIndex('variable') && t.modifiers === 0,
      );
      // x used twice: assignment target + return value
      expect(varUses.length).toBeGreaterThanOrEqual(1);
    });

    it('marks argument usage as parameter+readonly', () => {
      const tokens = getTokens('method: Foo\nat: index\n  ^ index\n%');
      const paramUses = tokens.filter(
        (t) =>
          t.tokenType === typeIndex('parameter') &&
          (t.modifiers & 2) === 2 &&
          (t.modifiers & 1) === 0,
      );
      // index used in ^index (usage, not declaration)
      expect(paramUses.length).toBeGreaterThanOrEqual(1);
    });

    it('marks instance variables as property', () => {
      const tokens = getTokens('method: Foo\nname\n  ^ name\n%');
      const props = tokens.filter((t) => t.tokenType === typeIndex('property'));
      expect(props.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('pseudo-variables', () => {
    it('marks self as keyword', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ self\n%');
      const keywords = tokens.filter((t) => t.tokenType === typeIndex('keyword'));
      expect(keywords.length).toBeGreaterThanOrEqual(1);
    });

    it('marks super as keyword', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ super foo\n%');
      const keywords = tokens.filter((t) => t.tokenType === typeIndex('keyword'));
      expect(keywords.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('literals', () => {
    it('marks number literals', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ 42\n%');
      const numbers = tokens.filter((t) => t.tokenType === typeIndex('number'));
      expect(numbers.length).toBeGreaterThanOrEqual(1);
    });

    it('marks string literals', () => {
      const tokens = getTokens("method: Foo\nfoo\n  ^ 'hello'\n%");
      const strings = tokens.filter((t) => t.tokenType === typeIndex('string'));
      expect(strings.length).toBeGreaterThanOrEqual(1);
    });

    it('marks symbol literals', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ #hello\n%');
      const symbols = tokens.filter((t) => t.tokenType === typeIndex('namespace'));
      expect(symbols.length).toBeGreaterThanOrEqual(1);
    });

    it('marks special literals (true, false, nil)', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ true\n%');
      const specials = tokens.filter((t) => t.tokenType === typeIndex('type'));
      expect(specials.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('message sends', () => {
    it('marks unary message selectors', () => {
      const tokens = getTokens('method: Foo\nfoo\n  ^ self size\n%');
      const methods = tokens.filter(
        (t) => t.tokenType === typeIndex('method') && t.modifiers === 0,
      );
      expect(methods.length).toBeGreaterThanOrEqual(1);
    });

    it('marks keyword message selectors', () => {
      const tokens = getTokens('method: Foo\nfoo\n  self at: 1 put: 2\n%');
      // Should have keyword tokens for at: and put:
      const methods = tokens.filter(
        (t) => t.tokenType === typeIndex('method') && t.modifiers === 0,
      );
      expect(methods.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('blocks', () => {
    it('marks block parameters as parameter+declaration+readonly', () => {
      const tokens = getTokens('method: Foo\nfoo\n  #(1 2 3) do: [:each | each]\n%');
      const blockParams = tokens.filter(
        (t) => t.tokenType === typeIndex('parameter') && (t.modifiers & 1) === 1,
      );
      expect(blockParams.length).toBeGreaterThanOrEqual(1);
    });

    it('marks block temporaries as variable+declaration', () => {
      const tokens = getTokens('method: Foo\nfoo\n  [| temp | temp := 1] value\n%');
      const blockTemps = tokens.filter(
        (t) => t.tokenType === typeIndex('variable') && (t.modifiers & 1) === 1,
      );
      expect(blockTemps.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('class definition', () => {
    // A class definition is shown in a 'smalltalk-code' region, which the LSP
    // wraps in a synthetic '_doIt' method so the method parser can be reused.
    // The wrapper's selector must not leak a token onto the real expression —
    // that used to split the superclass name into two colors.
    const source = [
      "Object subclass: 'Foo'",
      '\tinstVarNames: #()',
      '\tinDictionary: UserGlobals',
    ].join('\n');
    const uri = 'gemstone://1/UserGlobals/Foo/definition/Foo';

    it('does not emit a token on the synthetic wrapper line', () => {
      const tokens = getTokens(source, uri, 'smalltalk');

      // The '_doIt' wrapper sits one line above the real source; a token for it
      // lands on a negative line, which the editor clamps onto the superclass.
      const tokensAboveDocument = tokens.filter((t) => t.line < 0);

      expect(tokensAboveDocument).toHaveLength(0);
    });

    it('colors the superclass as a single global, like the dictionary', () => {
      const tokens = getTokens(source, uri, 'smalltalk');

      const globals = tokens.filter((t) => t.tokenType === typeIndex('property'));

      expect(globals).toHaveLength(2); // the superclass and the dictionary
      const superclass = globals.find((t) => t.line === 0)!;
      expect(superclass.startChar).toBe(0);
      expect(superclass.length).toBe('Object'.length);
    });
  });

  describe('encoding', () => {
    it('produces delta-encoded data', () => {
      const data = getEncodedTokens('method: Foo\nfoo\n  ^ 42\n%');
      // data should be groups of 5
      expect(data.length % 5).toBe(0);
      expect(data.length).toBeGreaterThan(0);
    });

    it('handles multiple methods in a topaz file', () => {
      const source = `method: Foo
foo
  ^ 42
%
method: Foo
bar
  ^ self
%`;
      const data = getEncodedTokens(source);
      expect(data.length % 5).toBe(0);
      expect(data.length).toBeGreaterThan(0);
    });
  });
});
