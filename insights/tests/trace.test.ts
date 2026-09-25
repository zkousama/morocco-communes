import { describe, expect, it } from "vitest";
import { exportSpans, newIds, traceparent } from "../src/trace.ts";
import { orderByDemand } from "../src/run.ts";

describe("the demand order", () => {
  const f = (code: string, score: number) => ({ code, score }) as never;
  it("puts the places people open first, then the rest by score", () => {
    const ordered = orderByDemand([f("a", 9), f("b", 5), f("c", 7)], new Map([["b", 40]])) as { code: string }[];
    expect(ordered.map((x) => x.code)).toEqual(["b", "a", "c"]);
  });
});

describe("tracing", () => {
  it("writes a W3C traceparent", () => {
    const { traceId, spanId } = newIds();
    expect(traceparent(traceId, spanId)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
  it("does nothing without an endpoint", async () => {
    await expect(exportSpans([], {})).resolves.toBeUndefined();
  });
});
