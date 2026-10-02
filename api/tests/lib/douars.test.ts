import { describe, expect, it } from "vitest";
import { withFractionNames, type DouarRecord, type FractionRecord } from "../../src/lib/douars.ts";

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
