import {describe, expect, it} from 'vitest';
import {GciLibrary} from '../gciLibrary';
import {useIntegrationTest} from './useIntegrationTest';
import {OOP_ILLEGAL, OOP_NIL, OOP_TRUE} from "../gciConstants";

describe('GciLibrary', () => {
    
    let gciLibrary: GciLibrary;
    let session: unknown;

    useIntegrationTest((gciLibraryToUse, sessionToUse) => {
        gciLibrary = gciLibraryToUse;
        session = sessionToUse;
    });
    
    it('executes a Smalltalk expression and returns its result', () => {
        const {result: utf8Oop} = gciLibrary.GciTsResolveSymbol(session, 'Utf8', OOP_NIL);
        
        const {result} = gciLibrary.GciTsExecute(session, 'false or: [ true ]', utf8Oop,OOP_ILLEGAL, OOP_NIL,0, 0);
        
        expect(result).toBe(OOP_TRUE);
    });

})