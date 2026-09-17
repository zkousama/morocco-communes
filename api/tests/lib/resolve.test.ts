import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../../src/emit/searchIndex.ts";
import { aliasPath, buildLookup, narrowestSource, resolve } from "../../src/lib/resolve.ts";

const rd = (n: string) => JSON.parse(readFileSync(`data/v1/attributes/${n}.json`, "utf8")) as never[];
const index = buildIndex("1.0.0", [
  { level: "commune", rows: rd("communes") },
  { level: "arrondissement", rows: rd("arrondissements") },
  { level: "province", rows: rd("provinces") },
  { level: "region", rows: rd("regions") },
  { level: "cercle", rows: rd("cercles") },
]);
const lookup = buildLookup(index);

describe("resolve", () => {
  it("accepts all three spellings of one commune's code", () => {
    for (const spelling of ["01.511.01.0", "001511010", "1511010"]) {
      const found = resolve(lookup, spelling);
      expect(found, spelling).toEqual({ kind: "found", code: "01.511.01.0", level: "commune" });
    }
  });

  it("accepts a slug", () => {
    expect(resolve(lookup, "tanger")).toEqual({ kind: "found", code: "01.511.01.0", level: "commune" });
  });

  it("accepts a name that only normalises to a slug", () => {
    expect(resolve(lookup, "Tétouan").kind).toBe("found");
  });

  it("resolves every commune by its dotted code and its padded digits", () => {
    for (const c of rd("communes") as { code: string; codeDigits: string }[]) {
      expect(resolve(lookup, c.code).kind, c.code).toBe("found");
      expect(resolve(lookup, c.codeDigits).kind, c.codeDigits).toBe("found");
    }
  });

  it("separates an absent code from a malformed one, which is a 404 against a 400", () => {
    expect(resolve(lookup, "99.999.99.99")).toEqual({ kind: "absent" });
    expect(resolve(lookup, "banana")).toEqual({ kind: "absent" });
    expect(resolve(lookup, "!!!")).toEqual({ kind: "malformed" });
    // Lenient on purpose: this normalises to "etc-passwd", a name-shaped thing that
    // names nothing. The caller routes on the resolved code, never on the raw input.
    expect(resolve(lookup, "../../etc/passwd")).toEqual({ kind: "absent" });
  });

  it("reports the level it found, so a wrong collection can be explained", () => {
    const levelOf = (raw: string) => {
      const found = resolve(lookup, raw);
      expect(found.kind, raw).toBe("found");
      return found.kind === "found" ? found.level : null;
    };
    expect(levelOf("01")).toBe("region");
    expect(levelOf("01.511")).toBe("province");
    expect(levelOf("01.511.05")).toBe("cercle");
    expect(levelOf("01.511.01.0")).toBe("commune");
    expect(levelOf("01.511.01.05")).toBe("arrondissement");
  });
});

describe("aliasPath", () => {
  it("rewrites a single filter to the file that already holds the answer", () => {
    expect(aliasPath({ province: "01.511", page: 1 })).toBe("/api/provinces/01.511/communes/page/1.json");
    expect(aliasPath({ cercle: "01.511.05", page: 2 })).toBe("/api/cercles/01.511.05/communes/page/2.json");
    expect(aliasPath({ region: "01", page: 1 })).toBe("/api/regions/01/communes/page/1.json");
    expect(aliasPath({ type: "urban", page: 3 })).toBe("/api/communes/type/urban/page/3.json");
    expect(aliasPath({ page: 7 })).toBe("/api/communes/page/7.json");
  });

  it("refuses to rewrite a combination no single file answers", () => {
    expect(aliasPath({ province: "01.511", type: "urban", page: 1 })).toBeNull();
    expect(aliasPath({ region: "01", province: "01.511", page: 1 })).toBeNull();
  });
});

describe("narrowestSource", () => {
  it("picks the smallest pre-rendered list, because each page is a subrequest", () => {
    expect(narrowestSource({ cercle: "01.511.05", province: "01.511", page: 1 })).toContain("/cercles/");
    expect(narrowestSource({ province: "01.511", region: "01", page: 1 })).toContain("/provinces/");
    expect(narrowestSource({ region: "01", type: "urban", page: 1 })).toContain("/regions/");
    expect(narrowestSource({ type: "rural", page: 1 })).toBe("/api/communes/type/rural/page");
  });
});
