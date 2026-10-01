import { describe, expect, it } from "vitest";
import { ARROW } from "../src/lib/arrow.ts";

const numbersOf = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("the arrow", () => {
  it("faces left as the right one mirrored about the middle", () => {
    // The numbers run x,y then H's lone x, then x,y pairs: x sits at 0, 2, 3, 5 and 7.
    const xs = new Set([0, 2, 3, 5, 7]);
    expect(numbersOf(ARROW.left)).toEqual(numbersOf(ARROW.right).map((v, i) => (xs.has(i) ? Math.round((18 - v) * 100) / 100 : v)));
  });

  it("faces up as the down one mirrored about the middle", () => {
    const down = numbersOf(ARROW.down);
    const up = numbersOf(ARROW.up);
    // Every y becomes 18 - y and every x stays: the first pair is x,y, then the V value is a y.
    expect(up).toEqual([down[0], 18 - down[1]!, 18 - down[2]!, down[3], 18 - down[4]!, down[5], 18 - down[6]!, down[7], 18 - down[8]!].map((v) => Math.round(v! * 100) / 100));
  });

  it("keeps every point inside its 18-unit box", () => {
    for (const d of Object.values(ARROW)) for (const v of numbersOf(d)) expect(v >= 0 && v <= 18).toBe(true);
  });
});
