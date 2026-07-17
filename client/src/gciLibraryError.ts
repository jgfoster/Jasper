import { GciError } from './gciLibrary';

/**
 * Thrown by {@link GciLibrary} when it cannot complete an operation.
 *
 * The cause may be a communication failure with GemStone, a failed
 * validation, or any other reason — the underlying GCI implementation is
 * intentionally not exposed. Callers can use `instanceof GciLibraryError` to
 * distinguish these failures from unrelated JavaScript errors.
 */
export class GciLibraryError extends Error {
  /** Builds a {@link GciLibraryError} from a GCI error struct, using its message. */
  static fromGciError(gciError: GciError) {
    return this.withMessage(gciError.message);
  }

  /** Builds a {@link GciLibraryError} with a plain message, for failures that don't originate from a GCI call (e.g. a failed validation). */
  static withMessage(message: string) {
    return new GciLibraryError(message);
  }

  private constructor(message: string) {
    super(message);
  }
}
