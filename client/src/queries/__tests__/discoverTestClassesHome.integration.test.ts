// Which dictionary test discovery gives a test class, against a live stone.
//
// The Test Explorer builds the links that open a test class or method from the dictionary
// discovery reports and the class's name, and the far end looks the class up by that name in
// that dictionary. So the dictionary has to be one that binds the class under its own name. The
// case that tells the difference: an earlier dictionary holds the test class under an alias and
// binds the class's name to a different, same-named class. Taking the first dictionary that
// holds the class under ANY key reports that one, and its links open the other class.
//
// Fully transient: the harness aborts after each test. Nothing commits.

import { describe, it, expect } from 'vitest';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import { discoverTestClasses, TestClassInfo } from '../discoverTestClasses';

const AHEAD = 'JasperDiscoveryAhead';
const HOME = 'JasperDiscoveryHome';
const TEST_CLASS = 'JasperDiscoveryShadowedTest';
const ALIAS_ONLY = 'JasperDiscoveryAliasOnlyTest';

describe('the dictionary test discovery reports for a class', () => {
  let gci: GciLibrary;
  let session: unknown;
  const exec = (code: string): string => gci.executeAndFetchString(session, code);

  useIntegrationTest((c) => {
    gci = c.gciLibrary;
    session = c.session;
  });

  const subclass = (name: string, dict: string): string =>
    `TestCase subclass: '${name}' instVarNames: #() classVars: #() classInstVars: #() ` +
    `poolDictionaries: #() inDictionary: ${dict} options: #()`;

  /**
   * AHEAD comes first on the symbol list. It binds TEST_CLASS to a twin with no tests, and holds
   * the real TEST_CLASS -- one test, bound under its own name in HOME -- under an alias. It also
   * holds ALIAS_ONLY, which nothing binds under its own name, under an alias.
   */
  function install(): void {
    exec(`| sl ahead home real aliasOnly |
sl := System myUserProfile symbolList.
ahead := SymbolDictionary new. ahead name: #${AHEAD}.
home := SymbolDictionary new. home name: #${HOME}.
sl addLast: ahead; addLast: home.
real := ${subclass(TEST_CLASS, 'home')}.
real compileMethod: 'testOne self assert: true' dictionaries: sl category: 'tests' environmentId: 0.
${subclass(TEST_CLASS, 'ahead')}.
ahead at: #${TEST_CLASS}Alias put: real.
aliasOnly := ${subclass(ALIAS_ONLY, 'home')}.
home removeKey: #${ALIAS_ONLY}.
ahead at: #${ALIAS_ONLY}Alias put: aliasOnly.
'installed'`);
  }

  const indexOf = (dictName: string): number =>
    Number(
      exec(
        `| sl | sl := System myUserProfile symbolList. (sl indexOf: (sl objectNamed: #${dictName})) printString`,
      ),
    );

  const rowsFor = (name: string): TestClassInfo[] =>
    discoverTestClasses(exec).filter((t) => t.className === name);

  it('reports the class in the dictionary that binds it under its own name', () => {
    install();

    const real = rowsFor(TEST_CLASS).find((t) => t.testCount === 1);

    expect(real).toMatchObject({ dictName: HOME, dictIndex: indexOf(HOME) });
  });

  it('keeps the same-named twin in its own dictionary', () => {
    install();

    const twin = rowsFor(TEST_CLASS).find((t) => t.testCount === 0);

    expect(twin).toMatchObject({ dictName: AHEAD, dictIndex: indexOf(AHEAD) });
  });

  it('gives the two same-named classes different dictionaries, so different test items', () => {
    install();

    expect(
      rowsFor(TEST_CLASS)
        .map((t) => t.dictName)
        .sort(),
    ).toEqual([AHEAD, HOME]);
  });

  it('addresses the class itself: its name in the reported dictionary is that class', () => {
    install();
    const real = rowsFor(TEST_CLASS).find((t) => t.testCount === 1)!;

    const tests = exec(
      `((System myUserProfile symbolList at: ${real.dictIndex}) at: #${TEST_CLASS}) testSelectors size printString`,
    );

    expect(tests).toBe('1');
  });

  it('leaves out a class nothing binds under its own name, which no link could open', () => {
    install();

    expect(rowsFor(ALIAS_ONLY)).toEqual([]);
  });
});
