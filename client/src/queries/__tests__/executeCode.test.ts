import { describe, it, expect } from 'vitest';
import { wrapExecuteCode } from '../executeCode';

describe('wrapExecuteCode', () => {
  // The block wrap is what lets `| x | x := 42. x + 1` and other
  // statement-sequence bodies parse — `(<code>) printString` only accepts a
  // single expression. The full block + `value printString` pattern remains.
  it('block-wraps the user code and sends printString', () => {
    const out = wrapExecuteCode('3 + 4');
    expect(out).toContain('[3 + 4] value printString');
  });

  it('block-wraps multi-statement bodies with temp declarations', () => {
    const out = wrapExecuteCode('| x | x := 42. x + 1');
    expect(out).toContain('[| x | x := 42. x + 1] value printString');
  });

  // GemStone signals AlmostOutOfStack with ~30 frames of headroom before a
  // hard stack overflow. We must catch it with a *minimal* handler (no
  // stream construction, no concatenation) because the handler itself runs
  // with very little stack room. This guard pins both the catch and the
  // minimal-handler shape so a future "improvement" can't quietly inflate it.
  it('catches AlmostOutOfStack with a fixed-literal handler', () => {
    const out = wrapExecuteCode('1');
    expect(out).toContain('on: AlmostOutOfStack');
    expect(out).toContain("'Error: AlmostOutOfStack");
    // No WriteStream / no concatenation inside the AlmostOutOfStack arm.
    const stackArm = out.match(/on: AlmostOutOfStack do: \[(.*?)\]/s)?.[1] ?? '';
    expect(stackArm).not.toContain('WriteStream');
    expect(stackArm).not.toContain(',');
  });

  // AbstractException is the outer net for everything else (DNU, ZeroDivide,
  // SyntaxError). It has stack room available so it can build the richer
  // error string the agent normally sees.
  it('catches AbstractException with a class+messageText handler', () => {
    const out = wrapExecuteCode('1');
    expect(out).toContain('on: AbstractException');
    expect(out).toContain('e class name asString');
    expect(out).toContain('e messageText asString');
  });

  // The handlers nest as `[[code] on: AlmostOutOfStack ...] on: AbstractException ...`
  // — AlmostOutOfStack is innermost so it intercepts before the more general
  // AbstractException handler (AlmostOutOfStack IS an AbstractException).
  it('nests AlmostOutOfStack inside AbstractException so the cheaper handler runs first', () => {
    const out = wrapExecuteCode('1');
    const stackIdx = out.indexOf('on: AlmostOutOfStack');
    const exIdx = out.indexOf('on: AbstractException');
    expect(stackIdx).toBeGreaterThan(-1);
    expect(exIdx).toBeGreaterThan(-1);
    expect(stackIdx).toBeLessThan(exIdx);
  });
});
