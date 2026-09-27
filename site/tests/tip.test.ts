import { describe, expect, it } from "vitest";
import { placeTip } from "../src/lib/tip.ts";
import type { Point, Rect } from "../src/lib/zoom.ts";

// A phone's map: 358px square, with the + and − buttons in the bottom right corner, 44px
// wide and 8px from the edges, as Map.astro draws them.
const frame = { width: 358, height: 358 };
const tip = { width: 180, height: 150 };
const buttons: Rect = { left: 306, top: 256, width: 44, height: 94 };

const overlaps = (at: Point, size: typeof tip, r: Rect) =>
  at.x < r.left + r.width && at.x + size.width > r.left && at.y < r.top + r.height && at.y + size.height > r.top;

describe("the map's tooltip", () => {
  it("sits below and right of the point", () => {
    expect(placeTip({ x: 50, y: 50 }, tip, frame, null)).toEqual({ x: 64, y: 64 });
  });

  it("goes above the point when there's no room below", () => {
    expect(placeTip({ x: 50, y: 300 }, tip, frame, null)).toEqual({ x: 64, y: 136 });
  });

  it("stays inside the frame", () => {
    expect(placeTip({ x: 340, y: 50 }, tip, frame, null)).toEqual({ x: 178, y: 64 });
    expect(placeTip({ x: 50, y: 100 }, tip, { width: 358, height: 200 }, null)).toEqual({ x: 64, y: 0 });
  });

  it("leaves a tip clear of the buttons where it is", () => {
    expect(placeTip({ x: 50, y: 50 }, tip, frame, buttons)).toEqual({ x: 64, y: 64 });
  });

  it("moves left of the buttons when it would cover them", () => {
    const at = placeTip({ x: 243, y: 120 }, tip, frame, buttons);
    expect(at.y).toBe(134);
    expect(at.x + tip.width).toBeLessThan(buttons.left);
    expect(overlaps(at, tip, buttons)).toBe(false);
  });

  it("moves right of buttons on the left, as a right-to-left page draws them", () => {
    const leftButtons: Rect = { left: 8, top: 256, width: 44, height: 94 };
    const at = placeTip({ x: 20, y: 120 }, tip, frame, leftButtons);
    expect(at.x).toBeGreaterThan(leftButtons.left + leftButtons.width);
    expect(overlaps(at, tip, leftButtons)).toBe(false);
  });

  it("moves above the buttons when the frame is too narrow to pass them", () => {
    const small = { width: 288, height: 288 };
    const smallButtons: Rect = { left: 236, top: 186, width: 44, height: 94 };
    const wide = { width: 240, height: 150 };
    const at = placeTip({ x: 100, y: 60 }, wide, small, smallButtons);
    expect(at.y + wide.height).toBeLessThan(smallButtons.top);
    expect(overlaps(at, wide, smallButtons)).toBe(false);
  });

  it("never covers the buttons from any point on a phone's map", () => {
    for (const reset of [false, true]) {
      // Zoomed in, the reset button joins the other 2 above them.
      const r: Rect = reset ? { left: 306, top: 206, width: 44, height: 144 } : buttons;
      for (let y = 0; y <= frame.height; y += 6) {
        for (let x = 0; x <= frame.width; x += 6) {
          const at = placeTip({ x, y }, tip, frame, r);
          expect(overlaps(at, tip, r)).toBe(false);
          expect(at.x).toBeGreaterThanOrEqual(0);
          expect(at.y).toBeGreaterThanOrEqual(0);
          expect(at.x + tip.width).toBeLessThanOrEqual(frame.width);
          expect(at.y + tip.height).toBeLessThanOrEqual(frame.height);
        }
      }
    }
  });
});
