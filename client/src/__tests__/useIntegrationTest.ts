import {GciLibrary} from "../gciLibrary";
import {afterAll, afterEach, beforeAll, beforeEach} from "vitest";

type UseIntegrationTestCallback = (gciLibraryToUse: GciLibrary, sessionToUse: unknown) => void;

/**
 * Sets up a full GemStone integration test environment for a Vitest describe block.
 *
 * Call this at the top of a `describe` block. It handles the entire lifecycle:
 * - Loads the GCI shared library and logs in before any tests run.
 * - Wraps each test in a transaction that is always aborted afterward,
 *   so database changes never leak between tests.
 * - Logs out and closes the library after all tests finish.
 *
 * The `callback` fires at the end of `beforeAll`, right after login — use it
 * to capture the `gciLibrary` and `session` into variables your tests can reach:
 *
 * ```ts
 * describe('my feature', () => {
 *   let gci: GciLibrary;
 *   let session: unknown;
 *
 *   useIntegrationTest((g, s) => { gci = g; session = s; });
 *
 *   it('does something', () => { ... });
 * });
 * ```
 *
 * Connection details are read from `process.env.VITE_GEMSTONE_*` variables.
 * Vite loads these automatically from `.env.test` when running in test mode —
 * run `npm run test:setup` to generate that file. To override individual values
 * for your local setup without touching `.env.test`, create `.env.test.local`
 * alongside it (gitignored; takes precedence).
 */
export function useIntegrationTest(callback: UseIntegrationTestCallback) {
    let gciLibrary: GciLibrary;
    let session: unknown;

    // gciLibrary and session are created inside a beforeAll hook, so they don't
    // exist at call time. The callback fires at the end of that hook, letting
    // callers assign the values into their own variables before any test runs.
    beforeAll(() => {
        handleIntegrationTestSetupErrorDuring(() => {
            gciLibrary = new GciLibrary(process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!);
            session = loginUsing(gciLibrary);
        });

        callback(gciLibrary, session);
    });

    afterAll(() => {
        if (!gciLibrary) return;
        if (session) {
            const { success, err } = gciLibrary.GciTsLogout(session);
            // Warn rather than throw — the session is gone regardless, and a
            // teardown error would obscure real test failures above it.
            if (!success) console.warn(`GciTsLogout failed [${err.number}]: ${err.message}`);
        }
        gciLibrary.close();
    });

    // Wrap each test in a GCI transaction. Always abort (never commit) so
    // database changes from one test don't leak into the next.
    beforeEach(() => {
            const { success, err } = gciLibrary.GciTsBegin(session);
            if (!success) {
                throw new Error(`GciTsBegin failed [${err.number}]: ${err.message}`)
        }
    });

    afterEach(() => {
        const { success, err } = gciLibrary.GciTsAbort(session);
        if (!success) {
            throw new Error(`GciTsAbort failed [${err.number}]: ${err.message}`)
        }
    });

    function loginUsing(gciLibrary: GciLibrary) {
        const {session, err} = gciLibrary.GciTsLogin(
            process.env.VITE_GEMSTONE_STONE_NRS!,
            null,
            null,
            false,
            process.env.VITE_GEMSTONE_GEM_NRS!,
            process.env.VITE_GEMSTONE_USER!,
            process.env.VITE_GEMSTONE_PASSWORD!,
            0,
            0,
        );
        
        if (err.number !== 0) throw new Error(`Login failed [${err.number}]: ${err.message}`);
        if (!session) throw new Error('GciTsLogin returned null session');

        return session;
    }

    function handleIntegrationTestSetupErrorDuring(callback: () => void) {
        try{
            callback();
        } catch (error) {
            const integrationTestInitializationErrorBanner = `
            -----------------------------------------------------------------------------------------
            Integration test initialization failed.

            A common cause is a missing or misconfigured test environment.

            If you haven't already, try running \`npm run test:setup\`.
            This installs the required test GemStone instance and creates or updates the \`.env.test\` file.

            If the environment is already set up, refer to the original error below for more details.
            -----------------------------------------------------------------------------------------
           
            `;

            if (error instanceof Error) {
                error.message = integrationTestInitializationErrorBanner + error.message;
                throw error;
            }

            throw new Error(integrationTestInitializationErrorBanner + JSON.stringify(error, null, 2));
        }
    }
}