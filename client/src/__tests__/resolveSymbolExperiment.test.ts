import {describe, expect, it} from 'vitest';
import {useIntegrationTest} from "./useIntegrationTest";
import {GciLibrary} from "../gciLibrary";
import {OOP_ILLEGAL, OOP_NIL} from "../gciConstants";

describe('GciTsResolveSymbol + PureExportSet experiment', () => {

    let gciLibrary: GciLibrary;
    let session: unknown;

    useIntegrationTest((gciLibraryToUse, sessionToUse) => {
        gciLibrary = gciLibraryToUse;
        session = sessionToUse;
    });

    function resolveUtf8() {
        const {result} = gciLibrary.GciTsResolveSymbol(session, 'Utf8', OOP_NIL);
        if (result === OOP_ILLEGAL) throw new Error('GciTsResolveSymbol failed');
        return result;
    }

    // Executes Smalltalk and returns the result as a JS string.
    // The code must return a UTF-8 encoded ByteArray (e.g. via encodeAsUTF8).
    function executeToString(utf8Oop: bigint, code: string) {
        const {result, err} = gciLibrary.GciTsExecute(session, code, utf8Oop, OOP_ILLEGAL, OOP_NIL, 0, 0);
        expect(err.number).toBe(0);
        const bytes = gciLibrary.GciTsFetchUtf8Bytes(session, result, 1n, 10 * 256 * 1024, 0);
        return bytes.data.subarray(0, Number(bytes.bytesReturned)).toString('utf8');
    }

    it('each call adds a new object to the PureExportSet, even when the returned OOP is always the same', () => {
        // First resolve — puts utf8Oop (the Utf8 class) into the PureExportSet.
        const utf8Oop = resolveUtf8();

        // Snapshot the PureExportSet to a server-side file so that reading it
        // back doesn't itself add objects to the set. Returns `true` the result
        // is not added to the PureExportSet
        gciLibrary.GciTsExecute(session, `
            | file |
            file := GsFile openWriteOnServer: 'PureExportSet-Baseline.txt'.
            file nextPutAll: ('|' join: ((GsBitmap newForHiddenSet: #PureExportSet) asArray collect: [ :each | each asOop asString ])).
            file close.
            true
        `, utf8Oop, OOP_ILLEGAL, OOP_NIL, 0, 0);

        // Three more resolves of the same symbol — all return the same OOP.
        const oop1 = resolveUtf8();
        const oop2 = resolveUtf8();
        const oop3 = resolveUtf8();
        expect(oop1).toBe(utf8Oop);
        expect(oop2).toBe(utf8Oop);
        expect(oop3).toBe(utf8Oop);

        // Read both snapshots and diff them.
        const combined = executeToString(utf8Oop, `
            | baseline experiment |
            baseline   := (GsFile openReadOnServer: 'PureExportSet-Baseline.txt') contents.
            experiment := '|' join: ((GsBitmap newForHiddenSet: #PureExportSet) asArray collect: [ :each | each asOop asString ]).
            (baseline, '%', experiment) encodeAsUTF8
        `);
        const [baselineStr, experimentStr] = combined.split('%');
        const baseline          = baselineStr.split('|').map(BigInt);
        const afterThreeResolves = experimentStr.split('|').map(BigInt);
        const newOops           = afterThreeResolves.filter(oop => !baseline.includes(oop));

        console.log('utf8Oop (the Utf8 class OOP)', utf8Oop);
        console.log('PureExportSet — baseline', baseline);
        console.log('PureExportSet — after 3 more resolves', afterThreeResolves);
        console.log('New OOPs (expected 3, one per call)', newOops);
        console.log('printString of each new OOP', newOops.map(oop =>
            executeToString(utf8Oop, `('Oop ', ${oop} asString, ' -> ', (Object objectForOop: ${oop}) printString) encodeAsUTF8`)
        ));
        // Finding: the 3 new OOPs print as 'Utf8' (with quotes) — they are
        // ByteString instances, not the Utf8 class. GciTsResolveSymbol
        // apparently creates a temporary ByteString from the const char*
        // argument on each call, and that object ends up in the PureExportSet.
    });
});
