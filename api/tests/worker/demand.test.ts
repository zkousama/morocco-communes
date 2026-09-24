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

  it("drops a phone number however it's written", () => {
    expect(scrubText("06 12 34 56 78")).toBe("");
    expect(scrubText("06.12.34.56.78")).toBe("");
    expect(scrubText("+212 6 12 34 56 78")).toBe("");
    expect(scrubText("٠٦١٢٣٤٥٦٧٨")).toBe("");
  });

  it("keeps a code in its dotted form, which names a place", () => {
    expect(scrubText("01.511.01.0")).toBe("01.511.01.0");
    expect(scrubText("04.501.03.11")).toBe("04.501.03.11");
    expect(scrubText("04.501.03.11.4")).toBe("04.501.03.11.4");
    expect(scrubText("tanger")).toBe("tanger");
    expect(scrubText("الرباط")).toBe("الرباط");
  });

  it("keeps a code-shaped text, given a way to check, only when it names a unit", () => {
    const known = (code: string) => code === "01.511.01.0";
    // A phone number grouped 2-3-2-2-1 has the shape of a code.
    expect(scrubText("06.123.45.67.8", known)).toBe("");
    expect(scrubText("01.511.01.0", known)).toBe("01.511.01.0");
  });

  it("reads a code typed with spaces as the dotted code", () => {
    expect(scrubText("01 511 01 0")).toBe("01.511.01.0");
    expect(scrubText(" 01  511 01 0 ", (code) => code === "01.511.01.0")).toBe("01.511.01.0");
  });

  it("counts circled digits with the rest", () => {
    expect(scrubText("⓪⑥ ①② ③④ ⑤⑥ ⑦⑧")).toBe("");
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

  // The drop checks have to see the whole text, not just what a 64-character cut leaves
  // behind, or a phone number, an email, a web address or a 7th word past the cut would
  // slip through uncounted.
  it("drops a phone number even when it starts past character 64", () => {
    expect(scrubText("a".repeat(60) + " 0612345678")).toBe("");
  });

  it("drops an email even when it starts past character 64", () => {
    expect(scrubText("a".repeat(70) + " x@y.com")).toBe("");
  });

  it("drops a web address even when it starts past character 64", () => {
    expect(scrubText("a".repeat(70) + " https://example.com")).toBe("");
  });

  it("drops a 7-word text even when the cut would otherwise leave 6 or fewer", () => {
    const text = Array(7).fill("x".repeat(10)).join(" ");
    // Confirms the fixture actually exercises the bug: a naive cut-then-check reads only
    // 6 tokens from the first 64 characters of this text.
    expect([...text.slice(0, 64)].join("").split(" ")).toHaveLength(6);
    expect(scrubText(text)).toBe("");
  });

  it("keeps a place name longer than 64 characters, cut to 64", () => {
    const long = scrubText("casablanca".repeat(10));
    expect(long).not.toBe("");
    expect([...long]).toHaveLength(64);
    expect(long).toBe("casablanca".repeat(10).slice(0, 64));
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
  kind: "search", text: "tanger", code: "", name: "search", results: 3, named: 1,
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
  const call = (name: string, args: Record<string, unknown>) =>
    mcpMessages({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

  it("keeps the place a tool names, by id or by unit, with the level it's given", () => {
    expect(call("get_commune", { id: "tanger" })).toEqual([{ method: "tools/call", tool: "get_commune", args: { place: "tanger" } }]);
    expect(call("get_indicators", { unit: "01.511.01.0" })).toEqual([
      { method: "tools/call", tool: "get_indicators", args: { place: "01.511.01.0" } },
    ]);
    expect(call("get_unit", { unit: "tiznit", level: "province" })).toEqual([
      { method: "tools/call", tool: "get_unit", args: { place: "tiznit", level: "province" } },
    ]);
    expect(call("get_commune", { id: "Tanger" })).toEqual([{ method: "tools/call", tool: "get_commune", args: { place: "tanger" } }]);
  });

  it("keeps no place that's neither a code nor a slug, and no level that isn't one", () => {
    expect(call("get_commune", { id: "Hay Mohammadi, rue 12" })).toEqual([{ method: "tools/call", tool: "get_commune", args: {} }]);
    expect(call("get_unit", { unit: "tiznit", level: "somewhere" })).toEqual([
      { method: "tools/call", tool: "get_unit", args: { place: "tiznit" } },
    ]);
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
