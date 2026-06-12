import { expect } from 'vitest';
import { URI } from 'vscode-uri';

expect.addEqualityTesters([
  function uriEquality(a: unknown, b: unknown): boolean | undefined {
    if (a instanceof URI && b instanceof URI) {
      return a.toString() === b.toString();
    }
    return undefined;
  },
]);
