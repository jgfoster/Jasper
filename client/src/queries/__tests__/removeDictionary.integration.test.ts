// Removing a dictionary, as the class list the Class Hierarchy and GemStone Search read sees it.
//
// That list is a cached ClassOrganizer (classOrganizer.ts), a snapshot of the image's classes.
// Removing a dictionary has to drop it, or the removed dictionary's classes go on appearing. And
// the rebuilt list has to keep a same-named class that another dictionary binds: the two are
// different classes, and only one of them went.
//
// Fully transient: the harness aborts after each test. Nothing commits.

import { describe, it, expect } from 'vitest';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import { removeDictionary } from '../removeDictionary';
import { getClassHierarchy } from '../getClassHierarchy';
import { searchMethodSource } from '../methodSearch';
import { clearClassOrganizerStatement } from '../classOrganizer';

const REMOVED = 'JasperRemovalGoing';
const KEPT = 'JasperRemovalStaying';
const ROOT = 'JasperRemovalRoot';
const TWIN = 'JasperRemovalTwin';
const MARKER = 'jasperRemovalMarker';

describe('removing a dictionary, as the Class Hierarchy and GemStone Search see it', () => {
  let gci: GciLibrary;
  let session: unknown;
  const exec = (code: string): string => gci.executeAndFetchString(session, code);

  useIntegrationTest((c) => {
    gci = c.gciLibrary;
    session = c.session;
  });

  const subclass = (superclass: string, name: string, dict: string): string =>
    `${superclass} subclass: '${name}' instVarNames: #() classVars: #() classInstVars: #() ` +
    `poolDictionaries: #() inDictionary: ${dict} options: #()`;

  /**
   * ROOT lives in KEPT. Each dictionary binds its own TWIN, a subclass of ROOT, and each twin
   * has a method containing MARKER -- so before the removal the Hierarchy lists two TWIN rows
   * under ROOT and a Source search finds two methods.
   */
  function install(): void {
    exec(`| sl going staying root |
sl := System myUserProfile symbolList.
going := SymbolDictionary new. going name: #${REMOVED}.
staying := SymbolDictionary new. staying name: #${KEPT}.
sl addLast: going; addLast: staying.
root := ${subclass('Object', ROOT, 'staying')}.
(${subclass('root', TWIN, 'going')}) compileMethod: 'marker ^''${MARKER}''' dictionaries: sl category: 'x' environmentId: 0.
(${subclass('root', TWIN, 'staying')}) compileMethod: 'marker ^''${MARKER}''' dictionaries: sl category: 'x' environmentId: 0.
'installed'`);
    // Another test's aborted fixture may have left a cached list behind; start from a fresh one.
    exec(`${clearClassOrganizerStatement()}
'cleared'`);
  }

  const twinRows = () =>
    getClassHierarchy(exec, ROOT, KEPT)
      .filter((e) => e.kind === 'subclass')
      .map((e) => ({ className: e.className, dictName: e.dictName, binding: e.binding }));

  const markerHits = () =>
    searchMethodSource(exec, MARKER, false).map(
      (r) => `${r.dictName} ${r.className}>>${r.selector}`,
    );

  it('lists both twins before the removal, with the cached list built', () => {
    install();

    expect(
      twinRows()
        .map((r) => r.dictName)
        .sort(),
    ).toEqual([REMOVED, KEPT].sort());
    expect(markerHits().sort()).toEqual(
      [`${REMOVED} ${TWIN}>>marker`, `${KEPT} ${TWIN}>>marker`].sort(),
    );
  });

  it('takes the removed dictionary’s class out of the Class Hierarchy and keeps the other', () => {
    install();
    twinRows(); // builds the cached list, as an open Hierarchy pane would have

    removeDictionary(exec, REMOVED);

    expect(twinRows()).toEqual([{ className: TWIN, dictName: KEPT, binding: 'bound' }]);
  });

  it('takes the removed dictionary’s class out of a Source search and keeps the other', () => {
    install();
    markerHits(); // builds the cached list, as an earlier search would have

    removeDictionary(exec, REMOVED);

    expect(markerHits()).toEqual([`${KEPT} ${TWIN}>>marker`]);
  });
});
