import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addUsage,
  classify,
  CLOUDFLARE_MAX_TOKENS,
  cloudflareTransport,
  FatalError,
  groqTransport,
  LimitError,
  NO_USAGE,
  openaiCompatibleTransport,
  TransientError,
  withRetries,
} from "../src/model.ts";

const KEY = "secret-key-123";
const options = { baseUrl: "https://example.test/v1", apiKey: KEY, provider: "groq", keyName: "GROQ_API_KEY" };
const call = { model: "openai/gpt-oss-120b", system: "the system", prompt: "the prompt", stage: "jury", key: "J1:reason:x" };

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
}

const fetchCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;

const ok = {
  model: "openai/gpt-oss-120b-2026",
  choices: [{ message: { role: "assistant", content: '{"ok":true}' } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 12 } },
};

beforeEach(() => { process.env.INSIGHTS_LIVE = "1"; });
afterEach(() => { delete process.env.INSIGHTS_LIVE; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the openai-compatible transport", () => {
  it("posts the system and user messages at temperature 0, the key in a bearer header and never the URL", async () => {
    respond(200, ok);
    await openaiCompatibleTransport(options)(call);
    const [url, init] = fetchCalls()[0]!;
    expect(String(url)).toBe("https://example.test/v1/chat/completions");
    expect(String(url)).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: "the system" },
        { role: "user", content: "the prompt" },
      ],
      temperature: 0,
    });
  });

  it("sends max_tokens only when asked to cap the reply", async () => {
    respond(200, ok);
    await openaiCompatibleTransport({ ...options, maxTokens: 250 })(call);
    expect(JSON.parse(fetchCalls()[0]![1].body).max_tokens).toBe(250);
  });

  it("reads the text, the model that answered and the tokens, reasoning tokens as thinking, at no cost", async () => {
    respond(200, ok);
    const reply = await openaiCompatibleTransport(options)(call);
    expect(reply.text).toBe('{"ok":true}');
    expect(reply.model).toBe("openai/gpt-oss-120b-2026");
    expect(reply.usage).toEqual({ input: 120, output: 30, thinking: 12, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
  });

  it("records the neurons a reply's usage reports, the way Cloudflare's does, and none when it reports none", async () => {
    respond(200, { ...ok, usage: { prompt_tokens: 41, completion_tokens: 2, total_tokens: 43, neurons: 1.5 } });
    expect((await openaiCompatibleTransport(options)(call)).usage).toEqual({ input: 41, output: 2, thinking: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, neurons: 1.5 });
    respond(200, ok);
    expect((await openaiCompatibleTransport(options)(call)).usage).not.toHaveProperty("neurons");
  });

  it("falls back to the call's model, no thinking, and an empty answer when the reply leaves them out", async () => {
    respond(200, { choices: [{ message: { content: null } }], usage: { prompt_tokens: 5, completion_tokens: 1 } });
    const reply = await openaiCompatibleTransport(options)(call);
    expect(reply).toMatchObject({ text: "", model: call.model });
    expect(reply.usage).toMatchObject({ input: 5, output: 1, thinking: 0 });
    respond(200, {});
    expect(await openaiCompatibleTransport(options)(call)).toMatchObject({ text: "", model: call.model, usage: { input: 0, output: 0 } });
  });

  it("turns a 429 into a limit with the wait its retry-after header asks for, in milliseconds", async () => {
    respond(429, { error: { message: "rate limit reached" } }, { "retry-after": "7" });
    const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
    expect(error).toBeInstanceOf(LimitError);
    expect(error.retryAfterMs).toBe(7_000);
  });

  it("reads a 429 with no retry-after as a limit with no wait of its own", async () => {
    respond(429, { error: { message: "rate limit reached" } });
    const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
    expect(error).toBeInstanceOf(LimitError);
    expect(error.retryAfterMs).toBeNull();
  });

  it("reads a 500, 502, 503 or 504 as a hiccup to retry", async () => {
    for (const status of [500, 502, 503, 504]) {
      respond(status, { error: { message: "over capacity" } });
      const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
      expect(error, `a ${status}`).toBeInstanceOf(TransientError);
      expect(String(error.message)).toContain(`groq answered ${status}`);
    }
  });

  it("reads a 400, 401, 403, 404 or 422 as fatal, carrying its status", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      respond(status, { error: { message: "no good" } });
      const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
      expect(error, `a ${status}`).toBeInstanceOf(FatalError);
      expect(classify(error)).toBe("fatal");
      expect(error.status).toBe(status);
      expect(String(error.message)).toContain(`groq answered ${status}`);
    }
  });

  it("reads Cloudflare's own error list when there's no OpenAI-style error", async () => {
    respond(400, { success: false, errors: [{ code: 5007, message: "no such model" }] });
    const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
    expect(String(error.message)).toContain("no such model");
  });

  it("gives any other status a plain error that names it", async () => {
    respond(409, { error: { message: "conflict" } });
    const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
    expect(error).not.toBeInstanceOf(FatalError);
    expect(error).not.toBeInstanceOf(TransientError);
    expect(error).not.toBeInstanceOf(LimitError);
    expect(String(error.message)).toContain("groq answered 409");
  });

  it("reads a network failure as a hiccup to retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`fetch failed for ${KEY}`); }));
    const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
    expect(error).toBeInstanceOf(TransientError);
    expect(String(error.message)).toContain("network error");
    expect(String(error.message)).not.toContain(KEY);
  });

  it("keeps the key out of every error, even when the answer quotes it back", async () => {
    for (const status of [400, 401, 404, 409, 422, 429, 500, 503]) {
      respond(status, { error: { message: `Invalid API Key ${KEY}` } });
      const error = await openaiCompatibleTransport(options)(call).catch((e) => e);
      expect(String(error.message), `a ${status}`).not.toContain(KEY);
      expect(String(error.stack), `a ${status}`).not.toContain(KEY);
    }
  });

  it("times out as a hiccup to retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const error = await openaiCompatibleTransport({ ...options, timeoutMs: 20 })(call).catch((e) => e);
    expect(error).toBeInstanceOf(TransientError);
    expect(String(error.message)).toBe("groq timed out after 20ms");
  });

  it("clears its timer once the answer is in", async () => {
    vi.useFakeTimers();
    respond(200, ok);
    await openaiCompatibleTransport(options)(call);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops at once on a fatal status, without a single retry", async () => {
    respond(401, { error: { message: "bad key" } });
    const waits: number[] = [];
    const wrapped = withRetries(openaiCompatibleTransport(options), { tries: 3, backoffMs: [5], limitPollMs: 1000, limitMaxMs: 10_000, sleep: async (ms) => { waits.push(ms); } });
    await expect(wrapped(call)).rejects.toThrow(/groq answered 401/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("needs a key, naming the provider and the variable and never a value", async () => {
    respond(200, ok);
    for (const apiKey of [undefined, ""]) {
      const error = await openaiCompatibleTransport({ ...options, apiKey })(call).catch((e) => e);
      expect(String(error.message)).toBe("groq needs GROQ_API_KEY in the local keys file");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("needs a live run, before it looks at the key", async () => {
    respond(200, ok);
    delete process.env.INSIGHTS_LIVE;
    await expect(openaiCompatibleTransport(options)(call)).rejects.toThrow(/INSIGHTS_LIVE/);
    await expect(openaiCompatibleTransport({ ...options, apiKey: undefined })(call)).rejects.toThrow(/INSIGHTS_LIVE/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("addUsage with neurons", () => {
  const plain = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, thinking: 3, costUsd: 0 };
  it("sums neurons when either side has them, and leaves them out when neither does", () => {
    expect(addUsage({ ...plain, neurons: 1.5 }, { ...plain, neurons: 2 })).toEqual({ input: 2, output: 4, cacheRead: 0, cacheWrite: 0, thinking: 6, costUsd: 0, neurons: 3.5 });
    expect(addUsage(NO_USAGE, { ...plain, neurons: 2 })).toMatchObject({ neurons: 2 });
    expect(addUsage(plain, plain)).not.toHaveProperty("neurons");
  });
});

describe("groq and cloudflare", () => {
  const local = { terms: [], keys: { GROQ_API_KEY: "groq-secret", CLOUDFLARE_ACCOUNT_ID: "acct-123", CLOUDFLARE_API_TOKEN: "cf-secret" } };

  it("sends groq's calls to its own endpoint with its own key, with no cap on the reply", async () => {
    respond(200, ok);
    await groqTransport(local)(call);
    const [url, init] = fetchCalls()[0]!;
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer groq-secret");
    expect(JSON.parse(init.body)).not.toHaveProperty("max_tokens");
  });

  it("caps every cloudflare reply at CLOUDFLARE_MAX_TOKENS", async () => {
    expect(CLOUDFLARE_MAX_TOKENS).toBe(1_000);
    respond(200, ok);
    await cloudflareTransport(local)({ ...call, model: "@cf/google/gemma-4-26b-a4b-it" });
    expect(JSON.parse(fetchCalls()[0]![1].body)).toEqual({
      model: "@cf/google/gemma-4-26b-a4b-it",
      messages: [
        { role: "system", content: "the system" },
        { role: "user", content: "the prompt" },
      ],
      temperature: 0,
      max_tokens: CLOUDFLARE_MAX_TOKENS,
    });
  });

  it("sends cloudflare's calls to the account's endpoint with its token", async () => {
    respond(200, ok);
    await cloudflareTransport(local)({ ...call, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });
    const [url, init] = fetchCalls()[0]!;
    expect(String(url)).toBe("https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1/chat/completions");
    expect(String(url)).not.toContain("cf-secret");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cf-secret");
    expect(JSON.parse(init.body).model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("names whichever of their variables is missing, and never calls", async () => {
    respond(200, ok);
    await expect(groqTransport({ terms: [], keys: {} })(call)).rejects.toThrow(/^groq needs GROQ_API_KEY/);
    await expect(groqTransport(null)(call)).rejects.toThrow(/GROQ_API_KEY/);
    await expect(cloudflareTransport({ terms: [], keys: { CLOUDFLARE_API_TOKEN: "cf-secret" } })(call)).rejects.toThrow(/^cloudflare needs CLOUDFLARE_ACCOUNT_ID/);
    await expect(cloudflareTransport({ terms: [], keys: { CLOUDFLARE_ACCOUNT_ID: "acct-123" } })(call)).rejects.toThrow(/^cloudflare needs CLOUDFLARE_API_TOKEN/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("needs a live run too", async () => {
    respond(200, ok);
    delete process.env.INSIGHTS_LIVE;
    await expect(groqTransport(local)(call)).rejects.toThrow(/INSIGHTS_LIVE/);
    await expect(cloudflareTransport({ terms: [], keys: {} })(call)).rejects.toThrow(/INSIGHTS_LIVE/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
