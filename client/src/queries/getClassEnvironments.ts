import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface EnvCategoryLine {
  isMeta: boolean;
  envId: number;
  category: string;
  selectors: string[];
  // Per-selector override bitmask keyed by bare selector: bit 1 = overrides a
  // superclass impl (▲), bit 2 = overridden in a subclass (▼). Selectors with
  // no indicator are absent. Always populated by the parser below.
  methodOverrideBits?: Record<string, number>;
}

export function getClassEnvironments(
  execute: QueryExecutor, dictIndex: number, className: string, maxEnv: number,
): EnvCategoryLine[] {
  // Each emitted selector token is prefixed with a single override-flag digit
  // (0..3) so the indicator rides along on the existing method-list round trip.
  // "Overridden in a subclass" is computed once by intersecting subclass-local
  // selectors with this class's own selectors, so the working set stays small
  // even for classes with thousands of subclasses (e.g. Object).
  const code = `| class envs stream instOwn metaOwn instSub metaSub |
envs := ${maxEnv}.
class := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
instOwn := class selectors asIdentitySet.
metaOwn := class class selectors asIdentitySet.
instSub := IdentitySet new.
metaSub := IdentitySet new.
class allSubclasses do: [:sub |
  sub selectors do: [:s | (instOwn includes: s) ifTrue: [instSub add: s]].
  sub class selectors do: [:s | (metaOwn includes: s) ifTrue: [metaSub add: s]]].
stream := WriteStream on: Unicode7 new.
{ class class. class. } doWithIndex: [:eachClass :idx |
  | isMeta subSel superCls |
  isMeta := idx = 1.
  subSel := isMeta ifTrue: [metaSub] ifFalse: [instSub].
  superCls := eachClass superclass.
  0 to: envs do: [:env |
    (eachClass _unifiedCategorys: env) keysAndValuesDo: [:categoryName :selectors |
      stream
        nextPutAll: eachClass name; tab;
        nextPutAll: env printString; tab;
        nextPutAll: categoryName; tab;
        yourself.
      selectors do: [:each | | up down |
        up := superCls notNil and: [(superCls whichClassIncludesSelector: each) notNil].
        down := subSel includes: each.
        stream
          nextPutAll: ((up ifTrue: [1] ifFalse: [0]) + (down ifTrue: [2] ifFalse: [0])) printString;
          nextPutAll: each; tab.
      ].
      stream lf.
    ].
  ].
].
stream contents`;

  const raw = execute(`getClassEnvironments(${className}, ${maxEnv})`, code);

  const results: EnvCategoryLine[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t').filter(s => s.length > 0);
    if (parts.length < 3) continue;
    const receiverName = parts[0];
    const envId = parseInt(parts[1], 10);
    const category = parts[2];
    const methodOverrideBits: Record<string, number> = {};
    const selectors = parts.slice(3).map((tok) => {
      // Leading digit is the override bitmask: 1 = overrides super, 2 =
      // overridden in subclass, 3 = both, 0 = neither.
      const methodOverrideBit = Number(tok[0]);
      const sel = tok.slice(1);
      if (methodOverrideBit) methodOverrideBits[sel] = methodOverrideBit;
      return sel;
    }).sort();
    const isMeta = receiverName.endsWith(' class');
    results.push({ isMeta, envId, category, selectors, methodOverrideBits });
  }
  return results;
}
