import { describe, expect, it } from "vitest";
import { SOURCES } from "../../src/sources/registry.js";

describe("SOURCES", () => {
  it("pins both HCP workbooks with their licence", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(ids).toContain("hcp-2024");
    expect(ids).toContain("hcp-2014");
  });

  it("uses absolute HCP urls", () => {
    for (const source of SOURCES) {
      expect(source.url.startsWith("https://www.hcp.ma/")).toBe(true);
      expect(source.licence.length).toBeGreaterThan(0);
    }
  });
});
