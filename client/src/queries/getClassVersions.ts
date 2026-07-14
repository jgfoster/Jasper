import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';

// className → version number, for every class in a dictionary whose class has
// MORE THAN ONE version in its class history, in a single round trip. Classes
// with a single version are omitted, so the Explorer renders them with no
// version tag; a returned entry means "show `Foo[n]`", where n is the 1-based
// position of the dictionary's class within its class history (base = 1). The
// GemStone Explorer uses this to make recompiled/reshaped class versions visible
// at a glance. Accepts a dictionary by 1-based index (canonical for Jasper) or
// by name.
export function getClassVersions(
  execute: QueryExecutor, dict: number | string,
): Map<string, number> {
  const dictExpr = typeof dict === 'number'
    ? `System myUserProfile symbolList at: ${dict}`
    : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | hist |
    hist := [v classHistory] on: Error do: [:e | nil].
    (hist notNil and: [hist size > 1]) ifTrue: [
      ws nextPutAll: k; tab; print: (hist indexOf: v); lf]]].
ws contents`;
  const label = typeof dict === 'number'
    ? `getClassVersions(dictIndex: ${dict})`
    : `getClassVersions(dictName: ${dict})`;
  const map = new Map<string, number>();
  for (const line of splitLines(execute(label, code))) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const version = parseInt(line.slice(tab + 1), 10);
    if (version > 0) map.set(line.slice(0, tab), version);
  }
  return map;
}
