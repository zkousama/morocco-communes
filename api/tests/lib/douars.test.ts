import { describe, expect, it } from "vitest";
import { withCommuneNames, withFractionNames, withSources, type DouarRecord, type FractionRecord } from "../../src/lib/douars.ts";

const fraction = (code: string, ar: string): FractionRecord => ({
  code,
  communeCode: "01.571.03.11",
  name: { ar },
  douars: 1,
  households: 1,
  population: 1,
});
const douar = (code: string, communeCode: string, ar: string, latin?: DouarRecord["latin"]) =>
  ({ code, communeCode, fraction: code.slice(0, 10), name: { ar }, ...(latin ? { latin } : {}) }) as DouarRecord;

describe("a douar's name from a source", () => {
  it("is the source's, without the mark GeoNames writes for ع", () => {
    const d = douar("5710311202001", "01.571.03.11", "أولاد علي");
    const sources = new Map([[d.code, { latin: { name: "Oulad ’Ali", source: "geonames" as const } }]]);
    expect(withSources(d, sources).latin).toEqual({ name: "Oulad Ali", source: "geonames" });
  });
});

describe("a fraction's Latin name", () => {
  it("is its commune's douar of the same name's, with that douar's source", () => {
    const [named] = withFractionNames([fraction("5710311201", "العنصر")], [douar("5710311202001", "01.571.03.11", "عنصر", { name: "El Ounsar", source: "osm" })]);
    expect(named!.latin).toEqual({ name: "El Ounsar", source: "osm" });
  });

  it("isn't borrowed from a douar of another commune", () => {
    const [named] = withFractionNames([fraction("5710311201", "العنصر")], [douar("5710513201001", "01.571.05.13", "العنصر", { name: "El Ounsar", source: "osm" })]);
    expect(named!.latin).toBeUndefined();
  });

  it("is a label where HCP lists the fraction under one rather than a name", () => {
    const [outside, notional] = withFractionNames([fraction("5710311297", "مشيخة خارج الجماعة"), fraction("5710311298", "مشيخة وهمية")], []);
    expect([outside!.label, notional!.label]).toEqual(["outside", "notional"]);
    expect(outside!.latin).toBeUndefined();
  });
});

describe("a name its commune shares", () => {
  const communes = [
    { code: "01.571.03.11", name: { fr: "Bir Gandouz", ar: "بئر كندوز" } },
    { code: "01.571.05.13", name: { fr: "Al Hamra", ar: "الحمراء" } },
  ];

  it("is HCP's Latin name for the commune, its spaces and article aside", () => {
    const [joined] = withCommuneNames([fraction("5710311201", "بئركندوز")], communes);
    expect(joined!.latin).toEqual({ name: "Bir Gandouz", source: "hcp" });
    const [bare] = withCommuneNames([douar("5710513201001", "01.571.05.13", "حمراء")], communes);
    expect(bare!.latin).toEqual({ name: "Al Hamra", source: "hcp" });
  });

  it("leaves a name a source writes, and a label", () => {
    const sourced = douar("5710311202001", "01.571.03.11", "بئر كندوز", { name: "Bir Guendouz", source: "osm" });
    expect(withCommuneNames([sourced], communes)[0]!.latin).toEqual({ name: "Bir Guendouz", source: "osm" });
    const labelled = { ...fraction("5710311297", "بئر كندوز"), label: "outside" as const };
    expect(withCommuneNames([labelled], communes)[0]!.latin).toBeUndefined();
  });

  it("isn't taken from another commune", () => {
    const [other] = withCommuneNames([douar("5710513201002", "01.571.05.13", "بئر كندوز")], communes);
    expect(other!.latin).toBeUndefined();
  });
});
