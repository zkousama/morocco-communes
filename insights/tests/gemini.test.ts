import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiTransport, LimitError, TransientError } from "../src/model.ts";

const local = { terms: [], keys: { GEMINI_API_KEY: "secret-key-123" } };
const call = { model: "gemini-3.8-flash", system: "s", prompt: "p", stage: "falsify", key: "k" };

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
}

beforeEach(() => { process.env.INSIGHTS_LIVE = "1"; });
afterEach(() => { delete process.env.INSIGHTS_LIVE; vi.unstubAllGlobals(); });

describe("the gemini transport", () => {
  it("sends the key in a header, never the URL, and asks for JSON", async () => {
    respond(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], modelVersion: "gemini-3.8-flash", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
    await geminiTransport(local)(call);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).not.toContain("secret-key-123");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key-123");
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe("application/json");
  });
  it("reads the text, the model and the tokens", async () => {
    respond(200, { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: '{"ok":true}' }] }, finishReason: "STOP" }], modelVersion: "gemini-3.8-flash", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } });
    const reply = await geminiTransport(local)(call);
    expect(reply.text).toBe('{"ok":true}');
    expect(reply.model).toBe("gemini-3.8-flash");
    expect(reply.usage).toMatchObject({ input: 10, output: 5, thinking: 7, costUsd: 0 });
  });
  it("gives an empty answer, not a crash, when there's nothing to read", async () => {
    respond(200, { candidates: [{ finishReason: "SAFETY" }] });
    expect((await geminiTransport(local)(call)).text).toBe("");
    respond(200, {});
    expect((await geminiTransport(local)(call)).text).toBe("");
  });
  it("turns a 429 into a limit with the wait it asks for", async () => {
    respond(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" }] } });
    const error = await geminiTransport(local)(call).catch((e) => e);
    expect(error).toBeInstanceOf(LimitError);
    expect(error.retryAfterMs).toBe(37_000);
  });
  it("turns a 503 into a hiccup to retry", async () => {
    respond(503, { error: { code: 503, status: "UNAVAILABLE", message: "high demand" } });
    await expect(geminiTransport(local)(call)).rejects.toBeInstanceOf(TransientError);
  });
  it("never puts the key in an error", async () => {
    respond(400, { error: { code: 400, message: "bad request" } });
    const error = await geminiTransport(local)(call).catch((e) => e);
    expect(String(error.message)).not.toContain("secret-key-123");
  });
  it("needs a key, and a live run", async () => {
    await expect(geminiTransport({ terms: [], keys: {} })(call)).rejects.toThrow(/GEMINI_API_KEY/);
    delete process.env.INSIGHTS_LIVE;
    await expect(geminiTransport(local)(call)).rejects.toThrow(/INSIGHTS_LIVE/);
  });
});
