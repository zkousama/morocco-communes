import { describe, expect, it } from "vitest";
import { mapPool } from "../src/pool.ts";

describe("mapPool", () => {
  it("keeps input order whatever order the work finishes in", async () => {
    const delays = [30, 5, 20, 1, 10];
    const out = await mapPool(delays, 3, async (ms, i) => { await new Promise((r) => setTimeout(r, ms)); return i; });
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });
  it("never runs more than its concurrency at once", async () => {
    let running = 0;
    let most = 0;
    await mapPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
    });
    expect(most).toBe(3);
  });
  it("runs one at a time at concurrency 1", async () => {
    const order: number[] = [];
    await mapPool([3, 1, 2], 1, async (ms, i) => { await new Promise((r) => setTimeout(r, ms)); order.push(i); });
    expect(order).toEqual([0, 1, 2]);
  });
});
