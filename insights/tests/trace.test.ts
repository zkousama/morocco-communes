import { afterEach, describe, expect, it, vi } from "vitest";
import { exportSpans, newIds, traceparent, type Span } from "../src/trace.ts";
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

describe("sending spans", () => {
  const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.test" };
  const ids = newIds();
  const parent = newIds().spanId;
  const span: Span = { traceId: ids.traceId, spanId: ids.spanId, parentSpanId: parent, name: "detect", start: 1, end: 2, attributes: { findings: 3 } };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends ids as hex, the way OTLP's JSON wants them", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response(null, { status: 200 });
    });
    await exportSpans([span], env);
    const sent = JSON.parse(bodies[0]!).resourceSpans[0].scopeSpans[0].spans[0];
    expect(sent.traceId).toBe(ids.traceId);
    expect(sent.spanId).toBe(ids.spanId);
    expect(sent.parentSpanId).toBe(parent);
  });

  it("says so in one line when the collector turns them down, and carries on", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad credentials", { status: 401 }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(exportSpans([span], env)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toMatch(/401/);
  });
});
