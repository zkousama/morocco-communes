import { describe, expect, it } from "vitest";
import { closeDouars, findDouars, prepare, type DouarNames } from "../../src/lib/douarSearch.ts";
import { arabicKeys, lookupKey } from "../../src/lib/translit.ts";

const douar = (ar: string, commune: number, rest: string, people: number, latin: string): DouarNames["douars"][number] => [
  ar,
  commune,
  rest,
  people,
  latin,
  0,
  [...new Set(arabicKeys(ar).map(lookupKey))].join("|"),
];
const index = prepare({
  communes: [
    ["asni", "Asni", "0410703"],
    ["tinzart", "Tinzart", "0410709"],
  ],
  douars: [
    douar("تشديرت", 0, "203002", 300, "Tachdirt"),
    douar("تشديرت", 1, "201004", 900, "Tachddirt"),
    douar("تيكراو", 1, "201001", 50, "Tigraou"),
  ],
});

describe("finding a douar by name", () => {
  it("finds it by its Arabic, the bigger first, with its commune and code", () => {
    const { total, hits } = findDouars(index, "تشديرت", 5);
    expect(total).toBe(2);
    expect(hits.map((h) => [h.name.latin, h.commune.slug, h.code])).toEqual([
      ["Tachddirt", "tinzart", "0410709201004"],
      ["Tachdirt", "asni", "0410703203002"],
    ]);
  });

  it("puts the spelling closest to what was typed first, whatever the douar's size", () => {
    expect(findDouars(index, "Tachdirt", 5).hits[0]!.name.latin).toBe("Tachdirt");
  });

  it("gives the search box only close spellings, not every name with the same consonants", () => {
    expect(closeDouars(index, "Tachdirt", 5).map((h) => h.name.latin)).toEqual(["Tachdirt", "Tachddirt"]);
    expect(closeDouars(index, "Tchd", 5)).toEqual([]);
  });
});
