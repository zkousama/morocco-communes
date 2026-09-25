import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  between,
  clamp,
  parseBox,
  pinch,
  pinchScale,
  panBy,
  toMap,
  toScreen,
  viewBoxOf,
  wheelZoom,
  whole,
  zoomAt,
  type Box,
  type Rect,
  type View,
} from "../src/lib/zoom.ts";

const box: Box = { x: 0, y: 0, width: 1000, height: 1000 };
// A frame drawn 500px square, 20px from the left of the window and 100px down.
const rect: Rect = { left: 20, top: 100, width: 500, height: 500 };
const centre = { x: 270, y: 350 };

const close = (a: View, b: View) => {
  expect(a.k).toBeCloseTo(b.k, 9);
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("the map's own units", () => {
  it("reads the generated viewBox", () => {
    expect(parseBox("0 0 1000 1000")).toEqual(box);
    expect(parseBox("-5,10 800 400")).toEqual({ x: -5, y: 10, width: 800, height: 400 });
  });

  it("shows the whole map at 1x", () => {
    expect(whole({ x: -5, y: 10, width: 800, height: 400 })).toEqual({ k: 1, x: -5, y: 10 });
  });
});

describe("clamping", () => {
  it("keeps the zoom between 1x and 12x", () => {
    expect(clamp({ k: 0.4, x: 0, y: 0 }, box).k).toBe(1);
    expect(clamp({ k: 40, x: 0, y: 0 }, box).k).toBe(MAX_ZOOM);
  });

  it("can't move the whole map at 1x", () => {
    expect(clamp({ k: 1, x: 120, y: -80 }, box)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it("keeps the frame inside the map when zoomed in", () => {
    // At 4x the frame spans 250 units, so its corner can't pass 750.
    expect(clamp({ k: 4, x: 900, y: -30 }, box)).toEqual({ k: 4, x: 750, y: 0 });
    expect(clamp({ k: 4, x: 300, y: 400 }, box)).toEqual({ k: 4, x: 300, y: 400 });
  });

  it("holds for a map that doesn't start at 0", () => {
    const offset = { x: -50, y: 20, width: 800, height: 400 };
    expect(clamp({ k: 2, x: -100, y: 500 }, offset)).toEqual({ k: 2, x: -50, y: 220 });
  });
});

describe("converting between the screen and the map", () => {
  it("puts the frame's corners on the view's corners", () => {
    const view = { k: 4, x: 300, y: 400 };
    expect(toMap(view, box, rect, { x: 20, y: 100 })).toEqual({ x: 300, y: 400 });
    expect(toMap(view, box, rect, { x: 520, y: 600 })).toEqual({ x: 550, y: 650 });
  });

  it("goes there and back", () => {
    const view = { k: 3.7, x: 123.4, y: 567.8 };
    const p = { x: 211, y: 432 };
    const back = toScreen(view, box, rect, toMap(view, box, rect, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe("zooming around a point", () => {
  it("zooms into the middle from the frame's centre", () => {
    expect(zoomAt(whole(box), box, rect, centre, 2)).toEqual({ k: 2, x: 250, y: 250 });
  });

  it("leaves the map point under the pointer where it was", () => {
    const start = { k: 2, x: 200, y: 300 };
    for (const p of [{ x: 100, y: 180 }, { x: 400, y: 520 }, centre]) {
      const before = toMap(start, box, rect, p);
      const after = toMap(zoomAt(start, box, rect, p, 6), box, rect, p);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it("stops at 12x", () => {
    expect(zoomAt({ k: 10, x: 400, y: 400 }, box, rect, centre, 30).k).toBe(MAX_ZOOM);
  });

  it("pulls the frame back inside the map when zooming out near an edge", () => {
    // Zoomed into the top right corner, then out around a point at the frame's left.
    const view = zoomAt({ k: 8, x: 875, y: 0 }, box, rect, { x: 20, y: 350 }, 2);
    expect(view).toEqual({ k: 2, x: 500, y: 0 });
  });

  it("goes back to the whole map at 1x from anywhere", () => {
    expect(zoomAt({ k: 5, x: 610, y: 90 }, box, rect, { x: 90, y: 510 }, 1)).toEqual(whole(box));
  });
});

describe("panning", () => {
  it("moves the map with the pointer", () => {
    // At 2x the frame shows 500 units across 500px: one unit a pixel.
    expect(panBy({ k: 2, x: 250, y: 250 }, box, rect, 100, -40)).toEqual({ k: 2, x: 150, y: 290 });
  });

  it("does nothing at 1x", () => {
    expect(panBy(whole(box), box, rect, 100, 100)).toEqual(whole(box));
  });

  it("can't drag the map out of the frame", () => {
    expect(panBy({ k: 2, x: 250, y: 250 }, box, rect, 5000, -5000)).toEqual({ k: 2, x: 0, y: 500 });
  });
});

describe("pinching", () => {
  it("scales by how far apart the fingers moved", () => {
    const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
    expect(pinchScale(from, [{ x: 50, y: 100 }, { x: 250, y: 100 }])).toBe(2);
    expect(pinchScale(from, [{ x: 125, y: 100 }, { x: 175, y: 100 }])).toBe(0.5);
    // Measured as a distance, so turning the fingers doesn't change it.
    expect(pinchScale(from, [{ x: 150, y: 50 }, { x: 150, y: 150 }])).toBeCloseTo(1, 9);
  });

  it("reads fingers that start on the same spot as no change", () => {
    expect(pinchScale([centre, centre], [{ x: 100, y: 100 }, { x: 300, y: 100 }])).toBe(1);
  });

  it("spreading around the centre is zooming at the centre", () => {
    const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 220, y: 350 }, { x: 320, y: 350 }];
    const to: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 170, y: 350 }, { x: 370, y: 350 }];
    close(pinch(whole(box), box, rect, from, to), zoomAt(whole(box), box, rect, centre, 2));
  });

  it("keeps the map point between the fingers between them as they move", () => {
    const start = { k: 3, x: 300, y: 300 };
    const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 200, y: 300 }, { x: 260, y: 340 }];
    const to: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 150, y: 250 }, { x: 330, y: 370 }];
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const before = toMap(start, box, rect, mid(...from));
    const view = pinch(start, box, rect, from, to);
    const after = toMap(view, box, rect, mid(...to));
    expect(view.k).toBeCloseTo(9, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("pans when 2 fingers move together without spreading", () => {
    const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 200, y: 300 }, { x: 300, y: 300 }];
    const to: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 230, y: 280 }, { x: 330, y: 280 }];
    close(pinch({ k: 2, x: 250, y: 250 }, box, rect, from, to), { k: 2, x: 220, y: 270 });
  });
});

describe("the viewBox", () => {
  it("is the generated one at 1x", () => {
    expect(viewBoxOf(whole(box), box)).toBe("0 0 1000 1000");
  });

  it("shrinks with the zoom, to 3 decimals", () => {
    expect(viewBoxOf({ k: 4, x: 100.123456, y: 200 }, box)).toBe("100.123 200 250 250");
    expect(viewBoxOf({ k: 3, x: 0, y: 0 }, box)).toBe("0 0 333.333 333.333");
  });

  it("keeps the map's proportions", () => {
    expect(viewBoxOf({ k: 2, x: -50, y: 20 }, { x: -50, y: 20, width: 800, height: 400 })).toBe("-50 20 400 200");
  });
});

describe("animating from one view to another", () => {
  it("starts at the first and ends at the second", () => {
    const a = { k: 1, x: 0, y: 0 };
    const b = { k: 4, x: 600, y: 120 };
    close(between(a, b, box, 0), a);
    close(between(a, b, box, 1), b);
  });

  it("zooms at an even pace, so halfway from 1x to 4x is 2x", () => {
    expect(between(whole(box), { k: 4, x: 0, y: 0 }, box, 0.5).k).toBeCloseTo(2, 9);
  });

  it("holds still the point it zooms around", () => {
    const a = { k: 2, x: 200, y: 300 };
    const p = { x: 140, y: 460 };
    const b = zoomAt(a, box, rect, p, 8);
    const fixed = toMap(a, box, rect, p);
    for (const t of [0.1, 0.35, 0.8]) {
      const seen = toMap(between(a, b, box, t), box, rect, p);
      expect(seen.x).toBeCloseTo(fixed.x, 9);
      expect(seen.y).toBeCloseTo(fixed.y, 9);
    }
  });

  it("slides at one zoom", () => {
    close(between({ k: 3, x: 100, y: 100 }, { k: 3, x: 300, y: 0 }, box, 0.25), { k: 3, x: 150, y: 75 });
  });
});

describe("the wheel", () => {
  it("zooms in for a wheel turned away and out for one turned back", () => {
    expect(wheelZoom(0, 0)).toBe(1);
    expect(wheelZoom(-30, 0)).toBeGreaterThan(1);
    expect(wheelZoom(30, 0)).toBeLessThan(1);
  });

  it("follows a trackpad pinch exactly", () => {
    // Chrome sends a pinch as a ctrl wheel with deltaY = -100 ln(scale).
    expect(wheelZoom(-100 * Math.log(1.1), 0)).toBeCloseTo(1.1, 9);
  });

  it("zooms no more than 2x for one notch", () => {
    expect(wheelZoom(-500, 0)).toBe(2);
    expect(wheelZoom(500, 0)).toBe(0.5);
  });

  it("reads a wheel that counts in lines", () => {
    expect(wheelZoom(-3, 1)).toBeCloseTo(wheelZoom(-48, 0), 9);
  });
});
