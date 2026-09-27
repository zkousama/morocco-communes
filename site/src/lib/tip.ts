/**
 * Where the home map's tooltip goes. Everything is in CSS pixels from the frame's top left
 * corner, so this works out a position and Map.astro moves the tooltip to it.
 */
import type { Point, Rect } from "./zoom.ts";

export interface Size {
  width: number;
  height: number;
}

// How far the tooltip sits from the point it names, and from the zoom buttons.
const OFFSET = 14;
const GAP = 6;

/**
 * The tooltip's top left corner for a point on the map: below and right of the point, above
 * it when there's no room below, and inside the frame. The zoom buttons sit in a bottom
 * corner, so a tooltip that would cover them moves beside them, or above them when the
 * frame is too narrow to pass them.
 */
export const placeTip = (p: Point, tip: Size, frame: Size, buttons: Rect | null): Point => {
  let x = Math.min(Math.max(p.x + OFFSET, 0), frame.width - tip.width);
  const below = p.y + OFFSET;
  let y = Math.max(below + tip.height > frame.height ? p.y - tip.height - OFFSET : below, 0);
  if (
    buttons &&
    x < buttons.left + buttons.width + GAP &&
    x + tip.width > buttons.left - GAP &&
    y < buttons.top + buttons.height + GAP &&
    y + tip.height > buttons.top - GAP
  ) {
    const leftOf = buttons.left - GAP - tip.width;
    const rightOf = buttons.left + buttons.width + GAP;
    if (leftOf >= 0) x = leftOf;
    else if (rightOf + tip.width <= frame.width) x = rightOf;
    else y = Math.max(buttons.top - GAP - tip.height, 0);
  }
  return { x, y };
};
