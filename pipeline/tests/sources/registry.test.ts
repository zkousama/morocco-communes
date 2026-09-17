import { describe, expect, it } from "vitest";
import { SOURCES } from "../../src/sources/registry.ts";
import { assertChecksum, sha256 } from "../../src/fetch.ts";

describe("sha256", () => {
  it("hashes bytes to a known digest", () => {
    expect(sha256(new TextEncoder().encode("hcp"))).toBe(
      "fea8792f83d82093ae57c33ca21a4c278d4e20aa2d5504f1b0b3ae4349391dc3",
    );
  });
});

describe("assertChecksum", () => {
  it("accepts a first sighting, when nothing is pinned yet", () => {
    expect(() => assertChecksum("hcp-2024", "abc", undefined)).not.toThrow();
  });

  it("accepts a digest that matches its pin", () => {
    expect(() => assertChecksum("hcp-2024", "abc", "abc")).not.toThrow();
  });

  it("throws and names both digests when the pin disagrees", () => {
    expect(() => assertChecksum("hcp-2024", "abc", "def")).toThrow(/pinned:\s+def/);
    expect(() => assertChecksum("hcp-2024", "abc", "def")).toThrow(/fetched:\s+abc/);
  });
});

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
