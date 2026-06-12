// GT Perf Tracker: counts GCI round trips for GT Inspector performance tuning.
// This module is a singleton — every importer shares the same counter instance.
// The proxy wraps a GciLibrary instance so all round-trip methods are counted
// without modifying gciLibrary.ts. Enable/disable via gemstone.gtPerfTracking.

import { GciLibrary } from './gciLibrary';

// Methods that make actual network round trips to the GemStone server.
// Local-only methods (OopIsSpecial, I32ToOop, Encrypt, CallInProgress, etc.) are excluded.
const ROUND_TRIP_METHODS = new Set([
  'GciTsAbort', 'GciTsBegin', 'GciTsCommit',
  'GciTsExecute', 'GciTsExecute_', 'GciTsExecuteFetchBytes',
  'GciTsPerform', 'GciTsPerformFetchBytes', 'GciTsPerformFetchOops',
  'GciTsNbExecute', 'GciTsNbPerform', 'GciTsNbResult',
  'GciTsFetchBytes', 'GciTsFetchChars', 'GciTsFetchUtf8Bytes',
  'GciTsFetchOops', 'GciTsFetchNamedOops', 'GciTsFetchVaryingOops',
  'GciTsFetchObjInfo', 'GciTsFetchGbjInfo',
  'GciTsFetchSize', 'GciTsFetchVaryingSize', 'GciTsFetchClass',
  'GciTsFetchUnicode', 'GciTsFetchUtf8',
  'GciTsIsKindOf', 'GciTsIsSubclassOf', 'GciTsIsKindOfClass', 'GciTsIsSubclassOfClass',
  'GciTsObjExists',
  'GciTsResolveSymbol', 'GciTsResolveSymbolObj',
  'GciTsNewObj', 'GciTsNewByteArray',
  'GciTsNewString', 'GciTsNewString_',
  'GciTsNewSymbol',
  'GciTsNewUnicodeString', 'GciTsNewUnicodeString_',
  'GciTsNewUtf8String', 'GciTsNewUtf8String_',
  'GciTsNewStringFromUtf16',
  'GciTsStoreBytes', 'GciTsStoreOops', 'GciTsStoreNamedOops', 'GciTsStoreIdxOops',
  'GciTsCompileMethod', 'GciTsClassRemoveAllMethods', 'GciTsProtectMethods',
  'GciTsFetchTraversal', 'GciTsMoreTraversal', 'GciTsStoreTrav', 'GciTsStoreTravDoTravRefs',
  'GciTsGetFreeOops', 'GciTsSaveObjs', 'GciTsReleaseObjs', 'GciTsReleaseAllObjs',
  'GciTsAddOopsToNsc', 'GciTsRemoveOopsFromNsc',
  'GciTsDirtyObjsInit', 'GciTsDirtyExportedObjs',
  'GciTsBreak', 'GciTsClearStack', 'GciTsGemTrace',
  'GciTsContinueWith',
  'GciTsWaitForEvent', 'GciTsCancelWaitForEvent',
  'GciTsKeepAliveCount', 'GciTsKeyfilePermissions',
  'GciTsDebugConnectToGem', 'GciTsDebugStartDebugService',
  'GciTsDoubleToOop', 'GciTsOopToDouble',
  'GciTsI64ToOop', 'GciTsOopToI64',
]);

export interface GtPerfTracker {
  enabled: boolean;
  count: number;
  methodCounts: Map<string, number>;
  onCountChanged: (() => void) | undefined;
  increment(methodName: string): void;
  reset(): void;
  setEnabled(val: boolean): void;
}

export interface GtPerfQuickPickItem {
  label: string;
  description?: string;
  isSeparator?: boolean;
}

export const RESET_LABEL = '$(debug-restart) Reset Counter';
export const COPY_LABEL  = '$(copy) Copy to Clipboard';

export function buildGtPerfStatusBarText(count: number): string {
  return `$(record) GT Perf: ${count}`;
}

export function buildGtPerfClipboardText(tracker: GtPerfTracker): string {
  const sorted = [...tracker.methodCounts.entries()].sort((a, b) => b[1] - a[1]);
  return [
    `GT Perf: ${tracker.count} total GCI calls`,
    ...sorted.map(([method, count]) => `  ${method}: ${count}`),
  ].join('\n');
}

export function buildGtPerfQuickPickItems(tracker: GtPerfTracker): GtPerfQuickPickItem[] {
  const sorted = [...tracker.methodCounts.entries()].sort((a, b) => b[1] - a[1]);
  return [
    { label: RESET_LABEL, description: `clear all ${tracker.count} counts` },
    { label: COPY_LABEL,  description: 'copy breakdown to clipboard' },
    { label: '', isSeparator: true },
    ...sorted.map(([method, count]) => ({ label: method, description: String(count) })),
  ];
}

export const gtPerfTracker: GtPerfTracker = {
  enabled: false,
  count: 0,
  methodCounts: new Map(),
  onCountChanged: undefined,

  increment(methodName: string) {
    if (this.enabled) {
      this.count++;
      this.methodCounts.set(methodName, (this.methodCounts.get(methodName) ?? 0) + 1);
      this.onCountChanged?.();
    }
  },

  reset() {
    this.count = 0;
    this.methodCounts.clear();
    this.onCountChanged?.();
  },

  setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) {
      this.count = 0;
      this.methodCounts.clear();
    }
    this.onCountChanged?.();
  },
};

export function wrapWithGtPerfProxy(gci: GciLibrary): GciLibrary {
  return new Proxy(gci, {
    get(target, prop: string | symbol) {
      const val = (target as unknown as Record<string, unknown>)[prop as string];
      if (typeof val === 'function' && ROUND_TRIP_METHODS.has(prop as string)) {
        return (...args: unknown[]) => {
          gtPerfTracker.increment(prop as string);
          return (val as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof val === 'function' ? (val as Function).bind(target) : val;
    },
  }) as GciLibrary;
}
