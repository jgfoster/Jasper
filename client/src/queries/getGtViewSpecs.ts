import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface GtViewSpec {
  viewName: string;
  title: string;
  priority: number;
  methodSelector: string;
  dataTransport: number;
  columnSpecifications?: Array<{
    type: string;
    title: string;
    cellWidth: number | null;
    spawnsObjects: boolean;
  }>;
  // Populated for GtPhlowForwardViewSpecification: the real view type and columns after resolution
  resolvedViewName?: string;
  resolvedColumnSpecifications?: Array<{
    type: string;
    title: string;
    cellWidth: number | null;
    spawnsObjects: boolean;
  }>;
}

function gtExecute(execute: QueryExecutor, label: string, code: string): string | null {
  const wrapped = `[${code}] on: AbstractException do: [:e | 'GtError:', e messageText asString]`;
  try {
    const result = execute(label, wrapped);
    return result.startsWith('GtError:') ? null : result;
  } catch {
    return null;
  }
}

function resolveForwardViewSpec(
  execute: QueryExecutor,
  oop: bigint,
  forwardSelector: string,
): Pick<GtViewSpec, 'resolvedViewName' | 'resolvedColumnSpecifications'> | null {
  const code =
    `| viewed ds specDict |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(forwardSelector)}') phlowDataSource.
STONJSON toString: ds retrieveViewSpecificationForForwarding`;
  const result = gtExecute(execute, 'resolveForwardViewSpec', code);
  if (!result) return null;
  try {
    const spec = JSON.parse(result);
    return {
      resolvedViewName: spec.__typeName || spec.viewName || '',
      resolvedColumnSpecifications: spec.columnSpecifications,
    };
  } catch { return null; }
}

export function getGtViewSpecs(execute: QueryExecutor, oop: bigint): GtViewSpec[] | null {
  const code =
    `| viewed |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
STONJSON toString: (viewed getInspectorSpecificationData at: 'views')`;
  const result = gtExecute(execute, 'getGtViewSpecs', code);
  if (!result) return null;
  try {
    const specs = JSON.parse(result) as GtViewSpec[];
    specs.sort((a, b) => a.priority - b.priority);
    for (const spec of specs) {
      if (spec.viewName === 'GtPhlowForwardViewSpecification') {
        const resolved = resolveForwardViewSpec(execute, oop, spec.methodSelector);
        if (resolved) {
          spec.resolvedViewName = resolved.resolvedViewName;
          spec.resolvedColumnSpecifications = resolved.resolvedColumnSpecifications;
        }
      }
    }
    return specs;
  } catch {
    return null;
  }
}

export function fetchGtPrintTabData(
  execute: QueryExecutor,
  oop: bigint,
  methodSelector: string,
): { data: string | null; truncated: boolean } {
  const code =
    `| viewed obj ds textData s |
obj := Object _objectForOop: ${oop}.
viewed := GtRemotePhlowViewedObject new initializeWith: obj.
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
textData := ds getText.
s := WriteStream on: String new.
obj printOn: s.
textData at: 'truncated' put: (s position > (textData at: 'string') size).
STONJSON toString: textData`;
  const result = gtExecute(execute, 'fetchGtPrintTabData', code);
  let truncated = false;
  if (result) {
    try { truncated = JSON.parse(result).truncated === true; } catch {}
  }
  return { data: result, truncated };
}

export function fetchGtTextData(execute: QueryExecutor, oop: bigint, methodSelector: string): string | null {
  const code =
    `| viewed ds |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
STONJSON toString: ds getText`;
  return gtExecute(execute, 'fetchGtTextData', code);
}

export function fetchGtForwardRowOop(
  execute: QueryExecutor,
  itemOop: bigint,
  forwardSelector: string,
  nodeId: number,
): bigint | null {
  const code =
    `| viewed ds forwardDs item |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${itemOop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(forwardSelector)}') phlowDataSource.
ds retrieveViewSpecificationForForwarding.
forwardDs := ds retrieveForwardTargetDataSource.
item := forwardDs retrieveSentItemAt: ${nodeId}.
[item asOop printString] on: Error do: [:e | '']`;
  const result = gtExecute(execute, 'fetchGtForwardRowOop', code);
  if (!result || result.trim() === '') return null;
  try { return BigInt(result.trim()); } catch { return null; }
}

export function fetchGtRowOop(
  execute: QueryExecutor,
  itemOop: bigint,
  methodSelector: string,
  nodeId: number,
): bigint | null {
  const code =
    `| viewed ds node item |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${itemOop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
STONJSON toString: (ds retrieveItems: 1 fromIndex: ${nodeId}).
node := ds cachedNodes at: ${nodeId}.
item := node targetObject.
[item asOop printString] on: Error do: [:e | '']`;
  const result = gtExecute(execute, 'fetchGtRowOop', code);
  if (!result || result.trim() === '') return null;
  try { return BigInt(result.trim()); } catch { return null; }
}

export function fetchGtListTotal(
  execute: QueryExecutor,
  oop: bigint,
  methodSelector: string,
): number | null {
  const code =
    `| viewed ds |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
ds retrieveTotalItemsCount printString`;
  const result = gtExecute(execute, 'fetchGtListTotal', code);
  if (!result) return null;
  const n = parseInt(result.trim(), 10);
  return isNaN(n) ? null : n;
}

export function fetchGtTreeChildren(
  execute: QueryExecutor,
  itemOop: bigint,
  methodSelector: string,
  path: number[],
): string | null {
  const stPath = '{' + path.join('. ') + '}';
  const code =
    `| viewed ds |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${itemOop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
STONJSON toString: (ds retrieveChildrenForNodeAtPath: ${stPath})`;
  return gtExecute(execute, 'fetchGtTreeChildren', code);
}


export function fetchMethodSource(
  execute: QueryExecutor,
  oop: bigint,
  methodSelector: string,
  isClassSide: boolean,
): string | null {
  const recv = isClassSide
    ? `(Object _objectForOop: ${oop}) class theNonMetaClass class`
    : `(Object _objectForOop: ${oop}) class theNonMetaClass`;
  const code = `${recv} sourceCodeAt: #'${escapeString(methodSelector)}'`;
  return gtExecute(execute, 'fetchMethodSource', code);
}

export function fetchObjectMeta(execute: QueryExecutor, oop: bigint): string | null {
  const code =
    `| obj baseCls |
obj := Object _objectForOop: ${oop}.
baseCls := obj class theNonMetaClass.
STONJSON toString: (Dictionary new
  at: 'className' put: baseCls name;
  at: 'superclassName' put: (baseCls superclass ifNil: [''] ifNotNil: [:s | s name]);
  at: 'category' put: (baseCls category ifNil: ['']);
  at: 'comment' put: (baseCls comment ifNil: ['']);
  at: 'definition' put: baseCls definition;
  at: 'methodSelectors' put: baseCls selectors asSortedCollection asArray;
  at: 'classMethodSelectors' put: baseCls class selectors asSortedCollection asArray;
  yourself)`;
  return gtExecute(execute, 'fetchObjectMeta', code);
}

export function fetchGtListData(
  execute: QueryExecutor,
  oop: bigint,
  methodSelector: string,
  fromIndex: number,
  count: number,
): string | null {
  const code =
    `| viewed ds |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
STONJSON toString: (ds retrieveItems: ${count} fromIndex: ${fromIndex})`;
  return gtExecute(execute, 'fetchGtListData', code);
}

export function fetchGtForwardListData(
  execute: QueryExecutor,
  oop: bigint,
  forwardSelector: string,
  fromIndex: number,
  count: number,
): string | null {
  const code =
    `| viewed ds forwardDs |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(forwardSelector)}') phlowDataSource.
ds retrieveViewSpecificationForForwarding.
forwardDs := ds retrieveForwardTargetDataSource.
STONJSON toString: (forwardDs retrieveItems: ${count} fromIndex: ${fromIndex})`;
  return gtExecute(execute, 'fetchGtForwardListData', code);
}

export function fetchGtForwardListTotal(
  execute: QueryExecutor,
  oop: bigint,
  forwardSelector: string,
): number | null {
  const code =
    `| viewed ds forwardDs |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(forwardSelector)}') phlowDataSource.
ds retrieveViewSpecificationForForwarding.
forwardDs := ds retrieveForwardTargetDataSource.
forwardDs retrieveTotalItemsCount printString`;
  const result = gtExecute(execute, 'fetchGtForwardListTotal', code);
  if (!result) return null;
  const n = parseInt(result.trim(), 10);
  return isNaN(n) ? null : n;
}
