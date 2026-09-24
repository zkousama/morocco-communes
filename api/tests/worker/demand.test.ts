import { describe, expect, it } from "vitest";
import { isBot, localeOf, recordDemand, scrubText, viaSiteOf, type DemandRow } from "../../src/worker/demand.ts";
import { mcpMessages } from "../../src/worker/usage.ts";

describe("scrubText", () => {
  it("keeps a place the way a person typed it", () => {
    expect(scrubText("  Tanger ")).toBe("tanger");
    expect(scrubText("EL JADIDA")).toBe("el jadida");
    expect(scrubText("سيدي يحيى زعير")).toBe("سيدي يحيى زعير");
    expect(scrubText("Tétouan")).toBe("tétouan");
  });

  it("drops anything that looks like a person", () => {
    expect(scrubText("someone@example.com")).toBe("");
    expect(scrubText("0612345678")).toBe("");
    expect(scrubText("https://example.com/x")).toBe("");
    expect(scrubText("please tell me where my cousin lives in this town")).toBe("");
  });

  it("cuts at 64 characters without splitting one", () => {
    // BMP characters: each takes 1 UTF-16 code unit
    const bmpLong = "ⵜⴰⵎⴰⵣⵉⵖⵜ".repeat(20);
    const bmpCut = scrubText(bmpLong);
    expect([...bmpCut]).toHaveLength(64);
    expect(bmpCut.endsWith("�")).toBe(false);

    // Astral-plane characters: each takes 2 UTF-16 code units.
    // With 1 BMP char + 63 astral chars, the 64-unit boundary falls in the middle
    // of a surrogate pair. Array.from handles this correctly; plain slice would not.
    const astralMixed = "a" + "𐐷".repeat(63);
    const astralCut = scrubText(astralMixed);
    expect([...astralCut]).toHaveLength(64);
    // Verify no lone surrogates: every high surrogate must be followed by a low one
    for (let i = 0; i < astralCut.length; i++) {
      const code = astralCut.charCodeAt(i);
      const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
      const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
      if (isHighSurrogate) {
        expect(i + 1 < astralCut.length).toBe(true);
        expect(astralCut.charCodeAt(i + 1) >= 0xdc00 && astralCut.charCodeAt(i + 1) <= 0xdfff).toBe(true);
      }
      if (isLowSurrogate) {
        expect(i > 0).toBe(true);
        expect(astralCut.charCodeAt(i - 1) >= 0xd800 && astralCut.charCodeAt(i - 1) <= 0xdbff).toBe(true);
      }
    }
  });

  it("gives nothing for nothing", () => {
    expect(scrubText(undefined)).toBe("");
    expect(scrubText("   ")).toBe("");
  });
});

describe("viaSiteOf", () => {
  it("names the kind of site, never the address", () => {
    expect(viaSiteOf("https://www.reddit.com/r/agadir/comments/x/", "communes.pages.dev")).toBe("reddit");
    expect(viaSiteOf("https://www.google.com/", "communes.pages.dev")).toBe("search");
    expect(viaSiteOf("https://communes.pages.dev/communes/rabat/", "communes.pages.dev")).toBe("site");
    expect(viaSiteOf("https://example.org/page", "communes.pages.dev")).toBe("other");
    expect(viaSiteOf(null, "communes.pages.dev")).toBe("direct");
    expect(viaSiteOf("not a url", "communes.pages.dev")).toBe("other");
  });
});

describe("isBot", () => {
  it("marks the crawlers that already show up in the counts", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(1);
    expect(isBot("mcpbeat")).toBe(1);
    expect(isBot("sentineloracle/1.0")).toBe(1);
    expect(isBot("Mozilla/5.0 (X11; Linux x86_64)")).toBe(0);
    expect(isBot(undefined)).toBe(0);
  });
});

describe("localeOf", () => {
  it("reads the language off the path", () => {
    expect(localeOf("/fr/communes/rabat/")).toBe("fr");
    expect(localeOf("/communes/rabat/")).toBe("en");
    expect(localeOf("/api/search")).toBe("en");
  });
});

const row = (over: Partial<DemandRow> = {}): DemandRow => ({
  kind: "search", text: "tanger", code: "", name: "search", results: 3,
  locale: "en", country: "MA", via: "mozilla", viaSite: "reddit", client: "",
  bot: 0, dataset: "1.8.0", ...over,
});

describe("recordDemand", () => {
  it("writes one row, with the day in front", async () => {
    const bound: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          bound.push([sql, ...values]);
          return { run: async () => ({ success: true }) };
        },
      }),
    };
    await recordDemand(db as never, row(), new Date("2026-09-24T10:00:00Z"));
    expect(bound).toHaveLength(1);
    expect(bound[0]![0]).toContain("INSERT INTO events");
    expect(bound[0]![1]).toBe("2026-09-24");
    expect(bound[0]).toContain("tanger");
  });

  it("does nothing without a binding", async () => {
    await expect(recordDemand(undefined, row())).resolves.toBeUndefined();
  });

  it("swallows a database that throws", async () => {
    const db = { prepare: () => { throw new Error("D1 is down"); } };
    await expect(recordDemand(db as never, row())).resolves.toBeUndefined();
  });
});

describe("mcpMessages arguments", () => {
  it("keeps the code a tool names", () => {
    expect(
      mcpMessages({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_indicators", arguments: { code: "01.511.01.0" } } }),
    ).toEqual([{ method: "tools/call", tool: "get_indicators", args: { code: "01.511.01.0" } }]);
  });

  it("scrubs a free-text query the way a site search is scrubbed", () => {
    expect(
      mcpMessages({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "someone@example.com" } } }),
    ).toEqual([{ method: "tools/call", tool: "search", args: {} }]);
    expect(
      mcpMessages({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "Tiznit" } } }),
    ).toEqual([{ method: "tools/call", tool: "search", args: { query: "tiznit" } }]);
  });
});
