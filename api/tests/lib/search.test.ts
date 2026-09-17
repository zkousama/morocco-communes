import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../../src/emit/searchIndex.ts";
import { haversine, near, search } from "../../src/lib/search.ts";

const rd = (n: string) => JSON.parse(readFileSync(`data/v1/attributes/${n}.json`, "utf8")) as never[];
const index = buildIndex("1.0.0", [
  { level: "commune", rows: rd("communes") },
  { level: "arrondissement", rows: rd("arrondissements") },
  { level: "province", rows: rd("provinces") },
  { level: "region", rows: rd("regions") },
  { level: "cercle", rows: rd("cercles") },
]);

describe("buildIndex", () => {
  it("indexes every unit at every level", () => {
    expect(index.entries.length).toBe(1852);
    const levels = new Set(index.entries.map((e) => e[1]));
    expect([...levels].sort()).toEqual(["arrondissement", "cercle", "commune", "province", "region"]);
  });

  it("stores the normalised forms, so scoring never re-derives them per query", () => {
    const tanger = index.entries.find((e) => e[0] === "01.511.01.0")!;
    expect(tanger[7]).toBe("tanger");
    expect(tanger[9]).toBeGreaterThan(0);
  });

  it("rebuilds byte-identically", () => {
    const levels = [{ level: "commune" as const, rows: rd("communes") }];
    expect(JSON.stringify(buildIndex("1.0.0", levels))).toBe(JSON.stringify(buildIndex("1.0.0", levels)));
  });

  it("cannot sort its keys into the emitted file, and does not depend on doing so", () => {
    // 21 communes share a name, so their slugs carry the code digits, which produces
    // integer-like trigrams such as "101". V8 hoists those ahead of every string key, so
    // the emitted key order is not alphabetical. Determinism comes from the build order.
    const keys = Object.keys(index.postings);
    expect(keys).not.toEqual([...keys].sort());
    expect(keys.filter((k) => /^\d+$/.test(k)).length).toBeGreaterThan(0);
  });
});

describe("search", () => {
  it("finds a commune by its French name, its Arabic name and its slug", () => {
    for (const q of ["Tanger", "طنجة", "tanger"]) {
      const top = search(index, q, { levels: ["commune"] })[0]!;
      expect(top.code, q).toBe("01.511.01.0");
      expect(top.matched, q).toBe("exact");
    }
  });

  it("ranks the commune above the cercle of the same name", () => {
    const hits = search(index, "Tanger", { limit: 5 });
    expect(hits[0]!.level).toBe("commune");
    expect(hits[1]!.level).toBe("cercle");
    expect(hits[0]!.score).toBe(hits[1]!.score);
  });

  it("ranks a shorter prefix match above a longer one", () => {
    const hits = search(index, "Tanger", { limit: 5 });
    const province = hits.find((h) => h.level === "province")!;
    const region = hits.find((h) => h.level === "region")!;
    expect(province.name.fr).toBe("Tanger-Assilah");
    expect(province.score).toBeGreaterThan(region.score);
  });

  it("finds a name written with vowel marks and a tatweel that the data has neither of", () => {
    const hits = search(index, "طَنــْجَة", { levels: ["commune"] });
    expect(hits[0]!.code).toBe("01.511.01.0");
  });

  it("retrieves transliteration variants without any query expansion", () => {
    // Measured: of 31 alternate spellings, 29 are retrieved in the top 10 and 27 rank
    // first, so character-level expansion rules (ch/sh, ou/u, k/q) would earn nothing.
    const cases: [string, string][] = [
      ["Shefshaouen", "Chefchaouen"],
      ["Marrakesh", "Marrakech"],
      ["Tangier", "Tanger"],
      ["Qsar El Kbir", "Ksar El Kebir"],
      ["Ayt Qamra", "Ait Kamra"],
      ["Awlad Tayma", "Oulad Teima"],
      ["Bni Mellal", "Béni Mellal"],
    ];
    for (const [query, expected] of cases) {
      const names = search(index, query, { limit: 10 }).map((h) => h.name.fr);
      expect(names, query).toContain(expected);
    }
  });

  it("respects a level filter", () => {
    const hits = search(index, "Tanger", { levels: ["province"], limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.level).toBe("province");
  });

  it("returns nothing for a query with nothing searchable in it", () => {
    expect(search(index, "!!!")).toEqual([]);
    expect(search(index, "")).toEqual([]);
  });

  it("ranks identically across runs, so pagination over results is stable", () => {
    const a = search(index, "sidi", { limit: 20 });
    const b = search(index, "sidi", { limit: 20 });
    expect(a.map((h) => h.code)).toEqual(b.map((h) => h.code));
  });

  it("honours the limit", () => {
    expect(search(index, "sidi", { limit: 3 }).length).toBe(3);
  });
});

describe("haversine", () => {
  it("measures a known distance", () => {
    // Casablanca to Rabat is about 86 km.
    const d = haversine(33.5731, -7.5898, 34.0209, -6.8416);
    expect(d).toBeGreaterThan(80);
    expect(d).toBeLessThan(92);
  });

  it("is zero at the same point", () => {
    expect(haversine(33.5731, -7.5898, 33.5731, -7.5898)).toBe(0);
  });
});

describe("near", () => {
  it("returns communes nearest first, within the radius", () => {
    const hits = near(index, 33.5731, -7.5898, 25, 10);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[0]!.name.fr).toBe("Méchouar de Casablanca");
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.distanceKm).toBeGreaterThanOrEqual(hits[i - 1]!.distanceKm);
    }
    for (const h of hits) expect(h.distanceKm).toBeLessThanOrEqual(25);
  });

  it("returns only communes, never another level", () => {
    const codes = new Set(near(index, 33.5731, -7.5898, 50, 100).map((h) => h.code));
    const communes = new Set(index.entries.filter((e) => e[1] === "commune").map((e) => e[0]));
    for (const c of codes) expect(communes.has(c)).toBe(true);
  });

  it("returns nothing in the middle of the Atlantic", () => {
    expect(near(index, 30, -30, 50, 10)).toEqual([]);
  });

  it("widens with the radius", () => {
    const small = near(index, 33.5731, -7.5898, 10, 100).length;
    const large = near(index, 33.5731, -7.5898, 100, 100).length;
    expect(large).toBeGreaterThan(small);
  });
});
