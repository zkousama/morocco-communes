/**
 * OpenTelemetry tracing for a run, hand-written rather than pulled in as a dependency: the
 * OTLP/HTTP JSON body a collector wants is small enough to build directly. A span here is
 * one stage of the pipeline, or one finding's turn through a stage; `exportSpans` sends them
 * on, and does nothing at all unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so a run traces
 * nothing, and reaches no network, until someone opts in.
 */
import { randomBytes } from "node:crypto";

/** `n` random bytes as lowercase hex. Written by hand rather than through `Buffer#toString`, whose overload for a byte encoding this workspace's Cloudflare Workers types shadow. */
function randomHex(n: number): string {
  return Array.from(randomBytes(n), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  start: number; // ms since epoch
  end: number; // ms since epoch
  attributes: Record<string, string | number>;
}

/** A fresh trace and span id: 16 and 8 random bytes, the widths both `traceparent` and OTLP want. */
export function newIds(): { traceId: string; spanId: string } {
  return { traceId: randomHex(16), spanId: randomHex(8) };
}

/** A W3C traceparent header for a trace and span id: version `00`, sampled. */
export function traceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

const hexToBase64 = (hex: string): string => Buffer.from(hex, "hex").toString("base64");

/** A span's attributes as OTLP JSON wants them: one `{key, value}` pair each, a string or an int. */
function otlpAttributes(attributes: Record<string, string | number>): { key: string; value: { stringValue: string } | { intValue: string } }[] {
  return Object.entries(attributes).map(([key, value]) =>
    typeof value === "number" ? { key, value: { intValue: String(Math.trunc(value)) } } : { key, value: { stringValue: value } },
  );
}

/** A span as OTLP/HTTP JSON wants it: ids as base64 bytes, and times as nanoseconds since epoch carried as strings, since OTLP's 64-bit fields travel as JSON strings so they don't lose precision. */
function otlpSpan(span: Span): object {
  return {
    traceId: hexToBase64(span.traceId),
    spanId: hexToBase64(span.spanId),
    parentSpanId: span.parentSpanId ? hexToBase64(span.parentSpanId) : undefined,
    name: span.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: String(span.start * 1_000_000),
    endTimeUnixNano: String(span.end * 1_000_000),
    attributes: otlpAttributes(span.attributes),
  };
}

/** A comma-separated `key=value` list, the shape `OTEL_EXPORTER_OTLP_HEADERS` is always given in, as request headers. */
function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at > 0) headers[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return headers;
}

/**
 * POSTs `spans` to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` as OTLP/HTTP JSON, with the
 * headers `OTEL_EXPORTER_OTLP_HEADERS` carries. Does nothing, and never touches the network,
 * unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set: a failed export is swallowed, so a broken or
 * unreachable collector never breaks a run. Prompts and replies never reach a span's
 * attributes, so nothing sent here can leak one.
 */
export async function exportSpans(spans: Span[], env: NodeJS.ProcessEnv): Promise<void> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || spans.length === 0) return;

  const body = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "morocco-communes-insights" } }] },
        scopeSpans: [{ scope: { name: "insights" }, spans: spans.map(otlpSpan) }],
      },
    ],
  };

  try {
    await fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json", ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS) },
      body: JSON.stringify(body),
    });
  } catch {
    // A collector that's down or unreachable shouldn't fail the run it's only watching.
  }
}
