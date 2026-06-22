/**
 * The Transcript-capture wrapper for executed code.
 *
 * `CodeExecutor` runs user code inside this wrapper so Transcript writes can be
 * captured into SessionTemps. The wrapped source is what GemStone compiles and
 * stores as the doit's method source — so a debugger stopped in executed code
 * sees the *wrapped* text, full of `__vsc…` glue.
 *
 * Both halves live here, sharing one prefix/suffix, so the unwrap stays in lock
 * step with the wrap: if the glue ever changes, `unwrapTranscriptCapture` keeps
 * working (or, failing an exact match, degrades to showing the full source
 * rather than mangling it).
 */

/** Everything before the user code, ending at the block that holds it. */
export const TRANSCRIPT_CAPTURE_PREFIX = `| __vscCapture __vscOriginal __vscResult |
__vscCapture := WriteStream on: String new.
__vscOriginal := SessionTemps current at: #Transcript ifAbsent: [nil].
SessionTemps current at: #Transcript put: __vscCapture.
[__vscResult := [`;

/** Everything after the user code: close the block, restore Transcript, return. */
export const TRANSCRIPT_CAPTURE_SUFFIX = `] value]
  ensure: [
    SessionTemps current at: #Transcript put: __vscOriginal.
    SessionTemps current at: #'__vscTranscriptResult' put: __vscCapture contents.
  ].
__vscResult`;

/**
 * Wrap user code so Transcript writes are captured into SessionTemps. Returns
 * the wrapped source and the offset at which the user code begins (used to map
 * compile-error positions back into the user's selection).
 *
 * The user code is embedded directly in Smalltalk source (inside a block), NOT
 * inside a string literal, so single quotes must NOT be escaped.
 */
export function wrapWithTranscriptCapture(code: string): { wrappedCode: string; codeOffset: number } {
  return {
    wrappedCode: TRANSCRIPT_CAPTURE_PREFIX + code + TRANSCRIPT_CAPTURE_SUFFIX,
    codeOffset: TRANSCRIPT_CAPTURE_PREFIX.length,
  };
}

/**
 * Recover the user's original code from wrapped doit source. Returns the source
 * unchanged when it isn't a Transcript-capture wrapper (a plain doit, or a
 * future glue change), so the debugger never mangles unrecognised source.
 */
export function unwrapTranscriptCapture(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith(TRANSCRIPT_CAPTURE_PREFIX) && trimmed.endsWith(TRANSCRIPT_CAPTURE_SUFFIX)) {
    return trimmed
      .slice(TRANSCRIPT_CAPTURE_PREFIX.length, trimmed.length - TRANSCRIPT_CAPTURE_SUFFIX.length)
      .trim();
  }
  return source;
}
