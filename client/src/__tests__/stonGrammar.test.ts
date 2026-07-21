import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import { Registry, parseRawGrammar, INITIAL, type IGrammar } from 'vscode-textmate';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const onigWasmPath = path.join(
  repoRoot,
  'node_modules',
  'vscode-oniguruma',
  'release',
  'onig.wasm',
);
const grammarPath = path.join(repoRoot, 'syntaxes', 'ston.tmLanguage.json');

function readJson(rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

// ── The contribution wiring must be intact ──────────────────

describe('STON language contribution', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  it('registers the .ston extension with a valid language configuration', () => {
    const lang = pkg.contributes.languages.find((l: { id: string }) => l.id === 'ston');

    expect(lang).toBeDefined();
    expect(lang.extensions).toContain('.ston');
    expect(fs.existsSync(path.join(repoRoot, lang.configuration))).toBe(true);
    expect(() => readJson(lang.configuration)).not.toThrow();
  });

  it('registers a grammar whose scopeName matches its TextMate file', () => {
    const grammar = pkg.contributes.grammars.find(
      (g: { language: string }) => g.language === 'ston',
    );

    expect(grammar).toBeDefined();
    expect(grammar.scopeName).toBe('source.ston');
    const tm = readJson(grammar.path) as { scopeName: string };
    expect(tm.scopeName).toBe(grammar.scopeName);
  });
});

// ── The grammar must actually tokenize STON correctly ───────

describe('STON grammar tokenization', () => {
  let grammar: IGrammar;

  beforeAll(async () => {
    const wasm = fs.readFileSync(onigWasmPath);
    await oniguruma.loadWASM(wasm);
    const registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (s) => new oniguruma.OnigString(s),
      }),
      loadGrammar: async (scope) =>
        scope === 'source.ston'
          ? parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath)
          : null,
    });
    const loaded = await registry.loadGrammar('source.ston');
    if (!loaded) throw new Error('failed to load the source.ston grammar');
    grammar = loaded;
  });

  /** The scopes assigned to the first token whose text is exactly `token`. */
  function scopesOf(line: string, token: string): string[] {
    const { tokens } = grammar.tokenizeLine(line, INITIAL);
    for (const t of tokens) {
      if (line.slice(t.startIndex, t.endIndex) === token) return t.scopes;
    }
    throw new Error(`token ${JSON.stringify(token)} not found in ${JSON.stringify(line)}`);
  }

  it('marks a class-tagged object name as a type', () => {
    expect(scopesOf('Point { #x: 1 }', 'Point')).toContain('entity.name.type.class.ston');
  });

  it('marks a symbol used as a map key as a tag', () => {
    expect(scopesOf('#name: 1', '#name')).toContain('entity.name.tag.ston');
  });

  it('marks a bare symbol as a symbol constant', () => {
    expect(scopesOf('[ #foo ]', '#foo')).toContain('constant.other.symbol.ston');
  });

  it('keeps hyphens, dots and slashes inside a bare symbol', () => {
    expect(scopesOf('[ #Rowan-Core ]', '#Rowan-Core')).toContain('constant.other.symbol.ston');
    expect(scopesOf('[ #rowan/src ]', '#rowan/src')).toContain('constant.other.symbol.ston');
  });

  it('marks a single-quoted string', () => {
    expect(scopesOf("'hello'", 'hello')).toContain('string.quoted.single.ston');
  });

  it('escapes an embedded quote with a backslash rather than ending the string', () => {
    const line = "'Rowan\\'s project'";

    expect(scopesOf(line, "\\'")).toContain('constant.character.escape.ston');
    expect(scopesOf(line, 's project')).toContain('string.quoted.single.ston');
  });

  it('marks other backslash escapes inside a string', () => {
    expect(scopesOf("'a\\nb'", '\\n')).toContain('constant.character.escape.ston');
    expect(scopesOf("'a\\\\b'", '\\\\')).toContain('constant.character.escape.ston');
  });

  it('marks true/false/nil as language constants', () => {
    expect(scopesOf('true', 'true')).toContain('constant.language.ston');
    expect(scopesOf('nil', 'nil')).toContain('constant.language.ston');
  });

  it('marks a character literal', () => {
    expect(scopesOf('$a', '$a')).toContain('constant.character.ston');
  });

  it('marks an object reference', () => {
    expect(scopesOf('@3', '@3')).toContain('constant.other.reference.ston');
  });

  it('marks plain and radix numbers', () => {
    expect(scopesOf('42', '42')).toContain('constant.numeric.ston');
    expect(scopesOf('16rFF', '16rFF')).toContain('constant.numeric.radix.ston');
  });

  it('marks the key/value colon as punctuation', () => {
    expect(scopesOf('#x: 1', ':')).toContain('punctuation.separator.key-value.ston');
  });
});
