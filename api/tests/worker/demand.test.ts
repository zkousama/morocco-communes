import { describe, expect, it } from "vitest";
import { isBot, localeOf, scrubText, viaSiteOf } from "../../src/worker/demand.ts";

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
    const long = "ⵜⴰⵎⴰⵣⵉⵖⵜ".repeat(20);
    const cut = scrubText(long);
    expect([...cut]).toHaveLength(64);
    expect(cut.endsWith("�")).toBe(false);
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
