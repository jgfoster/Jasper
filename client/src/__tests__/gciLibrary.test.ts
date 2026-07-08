import {describe, expect, it, Mock, vi} from 'vitest';
import {GciLibrary} from '../gciLibrary';
import {GciTestContext, useIntegrationTest} from './useIntegrationTest';
import {GciLibraryError} from "../gciLibraryError";

describe('GciLibrary', () => {

    let gciLibrary: GciLibrary;
    let session: unknown;
    let testContext: GciTestContext;

    useIntegrationTest((testContextToUse) => {
        gciLibrary = testContextToUse.gciLibrary;
        session = testContextToUse.session;
        testContext = testContextToUse;
    });

    /** Asserts that `oop` is GemStone's `true` singleton. */
    function expectOopToBeTrue(oop: bigint) {
        expect(gciLibrary.isTrueOop(oop)).toBe(true);
    }

    /** Asserts that `oop` is GemStone's `nil` singleton. */
    function expectOopToBeNil(oop: bigint) {
        expect(gciLibrary.isNilOop(oop)).toBe(true);
    }

    /**
     * Asserts that `callback` throws a {@link GciLibraryError} when given a
     * Smalltalk snippet that signals a user-defined error (`self error: 'oops'`).
     *
     * The callback receives the Smalltalk snippet as its argument so it can
     * embed it in any expression under test (e.g. pass it to `execute`).
     */
    function expectToThrowExpectedGciLibraryError(callback: (signalExpectedErrorExpression: string) => unknown) {
        expectToThrowGciLibraryError(
            () => callback(`self error: 'oops'`),
            'a UserDefinedError occurred (error 2318), reason:halt, oops');
    }

    /**
     * Asserts that `callback` throws exactly the same `Error` instance it's
     * given when given a thunk that throws that error.
     *
     * The callback receives the thunk as its argument so it can invoke it
     * from anywhere in the expression under test (e.g. pass it to
     * `executeAndRelease`).
     */
    function expectToThrowExpectedError(callback: (throwExpectedError: () => never) => unknown) {
        const expectedError = new Error('oops');
        
        expect(() => callback(() => { throw expectedError })).toThrowExactly(expectedError);
    }
    
    /** Asserts that `callback` throws a {@link GciLibraryError} with `expectedMessage`. */
    function expectToThrowGciLibraryError(callback: () => unknown, expectedMessage: string) {
        expect(callback).toThrowInstanceOf(GciLibraryError, expectedMessage);
    }

    /** Asserts that the session's PureExportSet stays unchanged across `callback`. */
    function expectPureExportSetToStayUnchanged(callback: () => unknown) {
        expectPureExportSetToGainOnlyOopsProvidedBy(true, () => {
            callback();
            return [];
        });
    }

    /** Asserts that the session's PureExportSet gains only the oops `callback` declares, per `shouldGainOnlyProvidedOops`. */
    function expectPureExportSetToGainOnlyOopsProvidedBy(shouldGainOnlyProvidedOops: boolean, callback: () => bigint[]) {
        const pureExportSetGainedOnlyProvidedOops = gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, callback);

        expect(pureExportSetGainedOnlyProvidedOops).toBe(shouldGainOnlyProvidedOops);
    }

    /** Asserts that `UserGlobals` includes (or does not include) `key`, per `shouldBeIncluded`. */
    function expectUserGlobalsToInclude(key: string, shouldBeIncluded: boolean) {
        expect(gciLibrary.isIncludedInUserGlobals(session, key)).toBe(shouldBeIncluded);
    }
    
    describe('evaluating expressions', () => {

        it('returns the result of evaluating an expression', () => {
            const resultOop = gciLibrary.execute(session, `true`);

            expectOopToBeTrue(resultOop);
        });

        it('uses nil as the receiver for evaluated code', () => {
            const resultOop = gciLibrary.execute(session, `self`);

            expectOopToBeNil(resultOop);
        });

        it('resolves names against UserGlobals, Globals, and Published', () => {
            const resultOop = gciLibrary.execute(session, `System myUserProfile symbolList asSet = {UserGlobals. Globals. Published} asSet`);

            expectOopToBeTrue(resultOop);
        });

        it('executes code in the default environment', () => {
            const resultOop = gciLibrary.execute(session, `
                "Object class does not understand #'new' outside environment 0, so this
                would fail if execute runs code in a non-default environment."
                Object new.
                true`);

            expectOopToBeTrue(resultOop);
        });

        it('throws when the expression signals an error', () => {
            expectToThrowExpectedGciLibraryError(signalExpectedErrorExpression => {
                gciLibrary.execute(session, signalExpectedErrorExpression);
            });
        });

    });

    describe('evaluating expressions for effect only, discarding the result', () => {

        it('evaluates an expression', () => {
            const key = gciLibrary.nextKey();

            gciLibrary.executeDiscardingResult(session, `UserGlobals at: ${key} put: true`);

            expectUserGlobalsToInclude(key, true);
        })

        it('does not retain the discarded result in the PureExportSet', () => {
            expectPureExportSetToStayUnchanged(() => {
                gciLibrary.executeDiscardingResult(session, 'Object new');
            });
        })

        it('throws when the evaluated code signals an error', () => {
            expectToThrowExpectedGciLibraryError(signalExpectedErrorExpression => {
                gciLibrary.executeDiscardingResult(session, signalExpectedErrorExpression);
            });
        })

    });

    describe('creating strings', () => {

        it('creates a String object from the given contents', () => {
            const oop = gciLibrary.createString(session, 'hello');

            // The comparison source itself compiles literals as Utf8 (see
            // execute's doc comment) -- String>>= disallows comparing a plain
            // String against a Unicode-kind argument, so convert explicitly.
            expectOopToBeTrue(gciLibrary.execute(session, `(Object objectForOop: ${oop}) = 'hello' asString`));
        });

    });

    describe('resolving symbols', () => {

        /** Spies on `resolveSymbol` for the duration of `callback`, then restores it. */
        function spyOnResolveSymbol(callback: (spy: Mock<typeof GciLibrary.prototype.resolveSymbol>) => void) {
            const spy =  vi.spyOn(gciLibrary, 'resolveSymbol');
            
            try{
                callback(spy);
            } finally{
                spy.mockRestore();
            }
        }
        
        /**
         * Asserts a fresh symbol lookup happens for `sessionToUse`.
         *
         * Checks the looked-up session with `toBe`, not `toHaveBeenCalledWith`
         * -- koffi's session pointers have no enumerable properties, so
         * vitest's deep equality can't tell two different sessions apart and
         * would pass regardless of which one was actually used.
         *
         * @param sessionToUse - The session expected to require a fresh lookup; defaults to the shared `session`.
         */
        function expectUtf8OopToResolveViaSymbolLookup(sessionToUse: unknown = session) {
            spyOnResolveSymbol(resolveSymbolSpy => {
                gciLibrary.utf8ClassOop(sessionToUse);

                expect(resolveSymbolSpy).toHaveBeenCalledTimes(1);
                const [calledSession, calledSymbol] = resolveSymbolSpy.mock.calls[0];
                expect(calledSession).toBe(sessionToUse);
                expect(calledSymbol).toBe('Utf8');
            });
        }

        /** Asserts `session`'s already-cached Utf8 oop is reused, without a fresh symbol lookup. */
        function expectUtf8OopToBeCached() {
            spyOnResolveSymbol(resolveSymbolSpy => {
                gciLibrary.utf8ClassOop(session);

                expect(resolveSymbolSpy).not.toHaveBeenCalled();
            });
        }
        
        it('resolves the Utf8 class', () => {
            const expectedOop = gciLibrary.execute(session, 'Utf8');

            const utf8ClassOop = gciLibrary.utf8ClassOop(session);

            expect(utf8ClassOop).toBe(expectedOop);
        });

        it('resolves the Utf8 class via a symbol lookup the first time it is needed', () => {
            expectUtf8OopToResolveViaSymbolLookup();
        });

        it('reuses the cached Utf8 class oop on later lookups', () => {
            gciLibrary.utf8ClassOop(session);

            expectUtf8OopToBeCached();
        });
        
        it('adds only the resolved oop to the PureExportSet', () =>{
            expectPureExportSetToGainOnlyOopsProvidedBy(true, () => [
                gciLibrary.resolveSymbol(session, 'Object')
            ]);
        });

        it('does not modify the PureExportSet when a symbol lookup fails', () =>{
           expectPureExportSetToStayUnchanged(() => {
               expect(() => gciLibrary.resolveSymbol(session, '')).toThrow();
           });
        });
        
        it('resolves a symbol that exists in the user namespace', () => {
            const expectedOop = gciLibrary.execute(session, 'Object');

            const foundOop = gciLibrary.resolveSymbol(session, 'Object');
            
            expect(foundOop).equals(expectedOop);
        })

        it('throws when symbols cannot be resolved', () => {
            // Expected message is empty: GciTsResolveSymbolObj's "not found"
            // case leaves *err unpopulated, despite gcits.hf implying it does.
            expectToThrowGciLibraryError(
                () => gciLibrary.resolveSymbol(session, ''),
                ''
            )
        })
        
        it ('forces a fresh symbol lookup after releasing the cached oop', () => {
            gciLibrary.utf8ClassOop(session);

            gciLibrary.releaseCachedUtf8Oop(session);

            expectUtf8OopToResolveViaSymbolLookup();
        })

        it('re-resolves the Utf8 oop after a logout/login cycle', () => {
            gciLibrary.utf8ClassOop(session);
            testContext.logout();

            testContext.login();

            expectUtf8OopToResolveViaSymbolLookup();
        })

        it("a new session doesn't have another session's cached Utf8 oop", () => {
            gciLibrary.utf8ClassOop(session);

            testContext.withTransientSession(transientSession => {
                expectUtf8OopToResolveViaSymbolLookup(transientSession);
            });
        })

        it("logging out a session does not clear another session's cached Utf8 oop", () => {
            gciLibrary.utf8ClassOop(session);

            testContext.withTransientSession(() => {
                // Intentionally empty: withTransientSession logs it out as soon as this callback returns,
                // which is all this test needs -- it exercises the logout cache-cleanup
                // path for a session other than `session`, so the assertion below can
                // check that `session`'s own cached oop survived it untouched.
            });

            expectUtf8OopToBeCached();
        })
        
    });
    
    describe('UserGlobals management', () => {

        it ('retrieves the stored value under the returned key', () => {
            const key = gciLibrary.storeInUniqueUserGlobalsKey(session, 'true');

            const value = gciLibrary.execute(session, `UserGlobals at: ${key}`);

            expectOopToBeTrue(value);
        })

        it ('includes a key after it is stored', () => {
            const key = gciLibrary.storeInUniqueUserGlobalsKey(session, 'true');

            expectUserGlobalsToInclude(key, true);
        })

        it ('does not modify the PureExportSet when storing a UserGlobals key', () => {
            expectPureExportSetToStayUnchanged(() => gciLibrary.storeInUniqueUserGlobalsKey(session, 'true'));
        });

        it('gives each call a distinct key', () => {
            const firstKey = gciLibrary.storeInUniqueUserGlobalsKey(session, '1');
            const secondKey = gciLibrary.storeInUniqueUserGlobalsKey(session, '2');

            expect(firstKey).not.toBe(secondKey);
            expectOopToBeTrue(gciLibrary.execute(session, `(UserGlobals at: ${firstKey}) = 1`));
            expectOopToBeTrue(gciLibrary.execute(session, `(UserGlobals at: ${secondKey}) = 2`));
        });
    });
    
    describe('SessionTemps management', () =>{
        
        it('empties SessionTemps', () =>{
            const key = gciLibrary.nextKey();
            gciLibrary.executeDiscardingResult(session, `SessionTemps current at: ${key} put: true`);

            gciLibrary.resetSessionTemps(session);

            expectOopToBeTrue(gciLibrary.execute(session, 'SessionTemps current isEmpty'));
        })

        it('does not modify the PureExportSet when resetting SessionTemps', () =>{
            expectPureExportSetToStayUnchanged(()=> gciLibrary.resetSessionTemps(session));
        })

    })
    
    describe('PureExportSet management', () => {

        it('does not gain only the provided oops when the callback removes an object from the PureExportSet', () => {
            const oopToRemove = gciLibrary.execute(session, 'Object new');

            expectPureExportSetToGainOnlyOopsProvidedBy(false, () => {
                gciLibrary.releaseObject(session, oopToRemove);
                return []
            });
        });

        it('does not gain only the provided oops when the callback swaps objects in the PureExportSet', () => {
            const oopToSwap = gciLibrary.execute(session, 'Object new');

            expectPureExportSetToGainOnlyOopsProvidedBy(false, () => {
                gciLibrary.releaseObject(session, oopToSwap);
                gciLibrary.execute(session, 'Object new');
                return []
            });
        });

        it('gains only the provided oops when the callback does not change the PureExportSet', () => {
            expectPureExportSetToGainOnlyOopsProvidedBy(true, () => []);
        });

        it('gains only the provided oops when the callback adds an object to the PureExportSet', () => {
            expectPureExportSetToGainOnlyOopsProvidedBy(true, () => {
                const addedOop = gciLibrary.execute(session, 'Object new');
                return [addedOop];
            });
        });

        it('does not stay unchanged when the callback adds an undeclared object to it', () => {
            expectPureExportSetToGainOnlyOopsProvidedBy(false, () => {
                gciLibrary.execute(session, 'Object new');
                return [];
            });
        });

        it('re-throws errors from the callback', () => {
            expectToThrowExpectedError(throwExpectedError => {
                gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, throwExpectedError);
            });
        });

        it('cleans up the snapshot key when the callback succeeds', () => {
            let snapshotNameToRemove: string;
            const captureSnapshotName = (snapshotName: string) => {
                snapshotNameToRemove = snapshotName;
                return [];
            };

            gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, captureSnapshotName);

            expectUserGlobalsToInclude(snapshotNameToRemove!, false);
        });
        
        it('cleans up the snapshot key when the callback throws', () => {
            let snapshotNameToRemove: string;
            const captureSnapshotNameAndFail = (snapshotName: string) => {
                snapshotNameToRemove = snapshotName;
                throw new Error();
            };

            expect(() => gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, captureSnapshotNameAndFail)).toThrow();
            expectUserGlobalsToInclude(snapshotNameToRemove!, false);
        });
        
        it('still throws the original error when cleaning up the snapshot key also fails', () => {
            expectToThrowExpectedError(throwExpectedError => {
                gciLibrary.didPureExportSetGainOnlyOopsProvidedBy(session, (snapshotName: string) => {
                    // Removing the key here means it's already gone by the time
                    // didPureExportSetGainOnlyOopsProvidedBy's own cleanup tries to
                    // remove it again, so that second removal genuinely fails.
                    gciLibrary.executeDiscardingResult(session, `UserGlobals removeKey: ${snapshotName}`);
                    return throwExpectedError();
                })
            })
        });

        it('empties the PureExportSet', () =>{
            gciLibrary.execute(session, 'Object new');

            gciLibrary.releaseAllObjects(session);

            expectOopToBeTrue(gciLibrary.execute(session, '(GsBitmap newForHiddenSet: #PureExportSet) isEmpty'));
        })
        
    });

    describe('logging in', () => {
        
        it('throws a GciLibraryError when the credentials are invalid', () => {
            expectToThrowGciLibraryError(
                () => testContext.login({user: 'NonExistentUser'}),
                'Login failed:  the userId/password combination is invalid or expired.'
            )
        })
        
    })
    
});
