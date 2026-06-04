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

export function getGtViewSpecs(execute: QueryExecutor, oop: bigint): GtViewSpec[] | null {
  const code =
    `| viewed |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
STONJSON toString: (viewed getInspectorSpecificationData at: 'views')`;
  const result = gtExecute(execute, 'getGtViewSpecs', code);
  if (!result) return null;
  try {
    const specs = JSON.parse(result) as GtViewSpec[];
    return specs.sort((a, b) => a.priority - b.priority);
  } catch {
    return null;
  }
}

export function fetchGtTextData(execute: QueryExecutor, oop: bigint, methodSelector: string): string | null {
  const code =
    `| viewed ds |
viewed := GtRemotePhlowViewedObject new initializeWith: (Object _objectForOop: ${oop}).
ds := (viewed viewSpecificationsBySelector at: #'${escapeString(methodSelector)}') phlowDataSource.
STONJSON toString: ds getText`;
  return gtExecute(execute, 'fetchGtTextData', code);
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

export function fetchObjectMeta(execute: QueryExecutor, oop: bigint): string | null {
  const code =
    `| obj cls |
obj := Object _objectForOop: ${oop}.
cls := obj class.
STONJSON toString: (Dictionary new
  at: 'className' put: cls name;
  at: 'superclassName' put: (cls superclass ifNil: [''] ifNotNil: [:s | s name]);
  at: 'category' put: (cls category ifNil: ['']);
  at: 'comment' put: (cls comment ifNil: ['']);
  at: 'definition' put: cls definition;
  at: 'methodSelectors' put: cls selectors asSortedCollection asArray;
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
