import {expect} from 'vitest';

expect.extend({
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
        toThrowExactly(expectedError: Error): void;
        toThrowInstanceOf(ExpectedClass: Function & { prototype: Error }, expectedMessage: string): void;
    }
}
