import {expect} from 'vitest';

expect.extend({
    /**
     * Used to test that a function throws exactly the given error instance,
     * not merely an equal or same-typed one.
     *
     * @param callback - The function expected to throw.
     * @param expectedError - The exact `Error` instance `callback` must throw.
     */
    toThrowExactly(callback: () => unknown, expectedError: Error) {
        try {
            callback();
            return {
                pass: false,
                message: () => `Expected callback to throw ${expectedError}, but it did not throw.`,
            };
        } catch (error) {
            if (error !== expectedError) {
                return {
                    pass: false,
                    message: () => `Expected callback to throw exactly ${expectedError}, but it threw ${error}.`,
                    actual: error,
                    expected: expectedError,
                };
            }
        }

        return {
            pass: true,
            message: () => `Expected callback not to throw ${expectedError}, but it did.`,
        };
    },

    /**
     * Used to test that a function throws an instance of the given class
     * with the given message.
     *
     * @param callback - The function expected to throw.
     * @param ExpectedClass - The `Error` subclass `callback` must throw an instance of.
     * @param expectedMessage - The exact `message` the thrown error must have.
     */
    toThrowInstanceOf(callback: () => unknown, ExpectedClass: Function & { prototype: Error }, expectedMessage: string) {
        try {
            callback();
            return {
                pass: false,
                message: () => `Expected callback to throw a ${ExpectedClass.name} with message '${expectedMessage}', but it did not throw.`,
            };
        } catch (error) {
            if (!(error instanceof ExpectedClass)) {
                return {
                    pass: false,
                    message: () => `Expected callback to throw a ${ExpectedClass.name}, but it threw ${error}.`,
                    actual: error,
                    expected: ExpectedClass,
                };
            }

            const thrownError = error as Error;
            if (thrownError.message !== expectedMessage) {
                return {
                    pass: false,
                    message: () => `Expected callback to throw a ${ExpectedClass.name} with message '${expectedMessage}', but got '${thrownError.message}'.`,
                };
            }
        }

        return {
            pass: true,
            message: () => `Expected callback not to throw a ${ExpectedClass.name} with message '${expectedMessage}', but it did.`,
        };
    },
});

declare module 'vitest' {
    interface Assertion {
        /**
         * Used to test that a function throws exactly the given error instance,
         * not merely an equal or same-typed one.
         *
         * @param expectedError - The exact `Error` instance the received function must throw.
         */
        toThrowExactly(expectedError: Error): void;
        /**
         * Used to test that a function throws an instance of the given class
         * with the given message.
         *
         * @param ExpectedClass - The `Error` subclass the received function must throw an instance of.
         * @param expectedMessage - The exact `message` the thrown error must have.
         */
        toThrowInstanceOf(ExpectedClass: Function & { prototype: Error }, expectedMessage: string): void;
    }
}
