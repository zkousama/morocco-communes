/**
 * The site's arrow, drawn rather than set, the same mark as the one on byousama.pages.dev:
 * an 18-unit box and a 1.8 stroke, a right-angled head. The tip is pulled back from the edge
 * because a 90° mitre reaches 0.7071 × the stroke past it, so a new stroke means moving the
 * tip too. Each direction is the right-facing one turned or mirrored, so they can't drift apart.
 */
export const ARROW = {
  right: "M0.9 9H16.02M8.01 0.99L16.02 9L8.01 17.01",
  left: "M17.1 9H1.98M9.99 0.99L1.98 9L9.99 17.01",
  down: "M9 0.9V16.02M0.99 8.01L9 16.02L17.01 8.01",
  up: "M9 17.1V1.98M0.99 9.99L9 1.98L17.01 9.99",
} as const;

export type ArrowDirection = keyof typeof ARROW;
/** The box the paths are drawn in, and the stroke they're drawn with, in its units. */
export const ARROW_BOX = 18;
export const ARROW_STROKE = 1.8;
