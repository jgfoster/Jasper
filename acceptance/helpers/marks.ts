/**
 * How a storyboard frame marks what a step did — the one place to change it.
 *
 * These colours have to agree across two very different surfaces: the rings are
 * drawn into the live VS Code window and baked into the screenshot, while the
 * sentences are coloured by the storyboard page long afterwards. A reader only
 * reads them as one claim if they match exactly, so neither side owns the value
 * and both take it from here.
 *
 * A ring is therefore a fixed colour, not a themed one: it is a pixel in a PNG,
 * and cannot follow the page into light or dark mode.
 */
export const MARKS = {
  /** A control the step acted on — clicked, or typed into. */
  acted: '#ff2bd1',
  /** A control the step vouched for — asserted about. */
  checked: '#2bd7ff',
} as const;

/**
 * Separates the Gherkin step from the moment within it, in an attachment's
 * name. The storyboard reporter splits on this to file each frame under the
 * step it belongs to.
 */
export const FRAME_SEPARATOR = ' › ';
