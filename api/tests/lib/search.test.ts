import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../../src/emit/searchIndex.ts";
import { haversine, near, search } from "../../src/lib/search.ts";
import { buildAliases } from "../../src/emit/searchIndex.ts";
import { EXONYMS } from "../../src/lib/exonyms.ts";

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

describe("spelling variants", () => {
  const first = (q: string) => search(index, q, { limit: 1 })[0];

  it("finds a name written with other vowels, ou as w, or without its article", () => {
    for (const [query, name] of [
      ["ktama", "Ketama"],
      ["titwan", "Tétouan"],
      ["souira", "Essaouira"],
      ["jdida", "El Jadida"],
      ["sla", "Salé"],
      ["tmara", "Témara"],
      ["warzazat", "Ouarzazate"],
      ["tafrawt", "Tafraout"],
      ["qasba tadla", "Kasba Tadla"],
      ["rbat", "Rabat"],
    ]) {
      expect(first(query!), query).toMatchObject({ name: { fr: name }, matched: "spelling" });
    }
  });

  it("reads the Arabizi digits as letters", () => {
    expect(first("l3ayoun")).toMatchObject({ name: { fr: "Laâyoune" } });
  });

  it("puts the closest of several names with one skeleton first", () => {
    const hits = search(index, "tmara", { levels: ["commune"], limit: 4 });
    expect(hits.map((h) => h.name.fr)).toContain("Tamri");
    expect(hits[0]!.name.fr).toBe("Témara");
  });

  it("ranks below an exact name and a prefix", () => {
    expect(first("azilal")).toMatchObject({ name: { fr: "Azilal" }, matched: "exact" });
    expect(first("casa")).toMatchObject({ matched: "prefix" });
  });

  it("needs two consonants, so a single letter matches nothing by skeleton", () => {
    expect(search(index, "ia").every((h) => h.matched !== "spelling")).toBe(true);
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

describe("exonyms", () => {
  it("resolves every listed name to the unit it points at", () => {
    expect(Object.keys(index.aliases).length).toBe(EXONYMS.length);
    for (const { name } of EXONYMS) {
      const top = search(index, name, { limit: 1 })[0];
      expect(top, name).toBeDefined();
      expect(top!.matched, name).toBe("alias");
    }
  });

  it("finds the places trigram overlap cannot reach", () => {
    const cases: [string, string][] = [
      ["Fez", "Fès"],
      ["Alhucemas", "Al Hoceima"],
      ["Mogador", "Essaouira"],
      ["Mazagan", "El Jadida"],
      ["Villa Cisneros", "Dakhla"],
      ["Port Lyautey", "Kénitra"],
      ["El Aaiun", "Laâyoune"],
      ["Dar el Beida", "Casablanca"],
    ];
    for (const [query, expected] of cases) {
      expect(search(index, query, { limit: 1 })[0]!.name.fr, query).toBe(expected);
    }
  });

  it("refuses an alias that is already a real name, so it cannot shadow one", () => {
    // Anfa is an arrondissement of Casablanca as well as Casablanca's historical name.
    // Listing it would have sent a search for the arrondissement to the commune.
    expect(() =>
      buildAliases([
        ["06.141.01.0", "commune", "Casablanca", "الدار البيضاء", "casablanca", null, null, "casablanca", "الدار البيضا", 10, "061410100"],
        ["06.141.01.09", "arrondissement", "Anfa", "أنفا", "anfa", null, null, "anfa", "انفا", 4, "061410109"],
      ], [{ name: "Anfa", code: "06.141.01.0", origin: "test" }]),
    ).toThrow(/already a real name/);
    expect(search(index, "anfa", { limit: 1 })[0]!.level).toBe("arrondissement");
  });

  it("refuses an alias pointing at a code no unit has", () => {
    expect(() =>
      buildAliases(index.entries, [{ name: "Nowhere", code: "99.999.99.99", origin: "test" }]),
    ).toThrow(/which no unit has/);
  });

  it("leaves a real name outranking everything", () => {
    const top = search(index, "fes", { limit: 1 })[0]!;
    expect(top.name.fr).toBe("Fès");
    expect(top.matched).toBe("exact");
  });
});

describe("codes", () => {
  it("finds a unit by its code in every form an address takes", () => {
    for (const q of ["01.511.01.0", "001511010", "1511010"]) {
      expect(search(index, q)[0], q).toMatchObject({ code: "01.511.01.0", name: { fr: "Tanger" }, matched: "code" });
    }
  });

  it("finds a province and a région by theirs", () => {
    expect(search(index, "01.511")[0]).toMatchObject({ level: "province", name: { fr: "Tanger-Assilah" } });
    expect(search(index, "01")[0]).toMatchObject({ level: "region", code: "01" });
  });

  it("finds nothing for a code that names nothing, rather than a name that shares its digits", () => {
    expect(search(index, "999999999")).toEqual([]);
    expect(search(index, "01.999.99.9")).toEqual([]);
  });

  it("respects a level filter", () => {
    expect(search(index, "1511010", { levels: ["province"] })).toEqual([]);
  });
});
