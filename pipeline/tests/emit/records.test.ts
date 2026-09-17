import { describe, expect, it } from "vitest";
import { parseHcp2024 } from "../../src/sources/hcp2024.ts";
import { parseHcp2014 } from "../../src/sources/hcp2014.ts";
import { buildHierarchy } from "../../src/build/hierarchy.ts";
import { toRecords } from "../../src/emit/records.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const h = buildHierarchy(parseHcp2024(readCachedWorkbook(".cache/hcp-population-legale-2024.xlsx")));
const units2014 = parseHcp2014(readCachedWorkbook(".cache/hcp-population-legale-2014.xlsx"));
const records = toRecords(h, units2014);

describe("toRecords", () => {
  it("emits every commune with a slug and its parents", () => {
    expect(records.communes.length).toBe(1503);
    const tanger = records.communes.find((c) => c.code === "01.511.01.0")!;
    expect(tanger.slug).toBe("tanger");
    expect(tanger.parents).toEqual({ region: "01", province: "01.511", cercle: null });
    expect(tanger.type).toBe("urban");
  });

  it("attaches 2014 population by exact code where the code matches", () => {
    const exact = records.communes.filter((c) => c.provenance.population2014 === "hcp-2014:exact_code");
    expect(exact.length).toBe(1290);
  });

  it("computes no change where the 2014 source published no figure", () => {
    // Four communes in the Western Sahara provinces carry "pm" (pour mémoire) in the
    // 2014 workbook's count columns instead of a number, so HCP published no figure for
    // them. They join by code, keep a 2014 object, and have a null total and null change.
    const noFigure = records.communes.filter(
      (c) => c.provenance.population2014 === "hcp-2014:exact_code" && c.population.change === null,
    );
    expect(noFigure.map((c) => c.nameFrRaw).sort()).toEqual([
      "Commune d'Aghouinite*",
      "Commune de Lagouira*",
      "Commune de Mijik*",
      "Commune de Zoug*",
    ]);
    for (const c of noFigure) expect(c.population["2014"]?.total).toBeNull();
  });

  it("recovers the six big cities from their arrondissements, which 2014 has no commune row for", () => {
    const summed = records.communes.filter((c) => c.population.change?.basis === "arrondissement_sum");
    expect(summed.length).toBe(6);
    const casablanca = summed.find((c) => c.nameFrRaw === "Commune de Casablanca")!;
    expect(casablanca.population["2014"]?.total).toBe(3_357_173);
    expect(casablanca.provenance.population2014).toBe("hcp-2014:arrondissement_sum");
  });

  it("gives 1,296 communes a 2014 figure in total", () => {
    const withPrior = records.communes.filter((c) => c.population["2014"] !== null);
    expect(withPrior.length).toBe(1296);
  });

  it("leaves renumbered communes null rather than guessing", () => {
    const aitKamra = records.communes.find((c) => c.nameFrRaw === "Commune d'Ait Kamra")!;
    expect(aitKamra.population["2014"]).toBeNull();
    expect(aitKamra.population.change).toBeNull();
  });

  it("strips every label word, in both languages and however often it repeats", () => {
    const tanger = records.communes.find((c) => c.code === "01.511.01.0")!;
    expect(tanger.name.fr).toBe("Tanger");
    expect(tanger.name.ar).toBe("طنجة");
    // Casablanca's préfectures d'arrondissements are labelled twice over.
    const grouped = records.provinces.find((p) => (p as { code: string }).code === "06.141.01.00")!;
    expect((grouped as { name: { ar: string } }).name.ar).toBe("الدار البيضاء-أنفا");
    const single = records.provinces.find((p) => (p as { code: string }).code === "06.141.01.30")!;
    expect((single as { name: { ar: string } }).name.ar).toBe("الحي الحسني");
    // The French side is labelled twice over too.
    expect((grouped as { name: { fr: string } }).name.fr).toBe("Casablanca-Anfa");
    expect((single as { name: { fr: string } }).name.fr).toBe("Hay-Hassani");
    const residue = /^(commune|arrondissements?|cercle|province|préfecture|région)\b/i;
    for (const level of [records.regions, records.provinces, records.cercles, records.communes, records.arrondissements]) {
      for (const unit of level as { name: { fr: string } }[]) {
        expect(residue.test(unit.name.fr)).toBe(false);
      }
    }

    // Not one record anywhere should still open with a level's label word.
    const labels = ["جهة", "عمالة", "إقليم", "دائرة", "جماعة", "مقاطعات", "مقاطعة"];
    for (const level of [records.regions, records.provinces, records.cercles, records.communes, records.arrondissements]) {
      for (const unit of level as { name: { ar: string } }[]) {
        expect(labels.some((l) => unit.name.ar.startsWith(`${l} `))).toBe(false);
      }
    }
  });

  it("keeps the footnote marker out of display names but not out of nameFrRaw", () => {
    const mijik = records.communes.find((c) => c.code === "12.391.05.05")!;
    expect(mijik.nameFrRaw).toBe("Commune de Mijik*");
    expect(mijik.name.fr).toBe("Mijik");
    expect(mijik.name.ar).not.toContain("*");
    expect(mijik.slug).toBe("mijik");
    for (const c of records.communes) expect(c.name.fr).not.toContain("*");
  });

  it("keeps every urban centre, including the three communes that have several", () => {
    const total = records.communes.reduce((n, c) => n + c.urbanCentres.length, 0);
    expect(total).toBe(164);
    expect(records.communes.filter((c) => c.urbanCentres.length > 0).length).toBe(160);
    const ainChkef = records.communes.find((c) => c.codeDigits === "035910103")!;
    expect(ainChkef.urbanCentres.map((u) => u.name).sort()).toEqual([
      "Ain Chkef Al Andalous",
      "Ras El Mae",
    ]);
  });

  it("carries the published population at every level, not just communes", () => {
    const region = records.regions.find((r) => (r as { code: string }).code === "01") as
      { population: { "2024": { total: number } }; communeCount: number; provinceCount: number };
    expect(region.population["2024"].total).toBe(4030222);
    expect(region.provinceCount).toBeGreaterThan(0);
    expect(region.communeCount).toBeGreaterThan(0);
  });

  it("records provenance per field group", () => {
    const any = records.communes[0]!;
    expect(any.provenance.name).toBe("hcp-2024");
    expect(any.provenance.population2024).toBe("hcp-2024");
  });
});

describe("toRecords with geometry", () => {
  const withGeometry = toRecords(
    h,
    units2014,
    new Map([
      [
        "015110519",
        {
          codeDigits: "015110519",
          relationId: 424242,
          wikidata: "Q123",
          centroid: { lat: 35.66, lng: -5.83 },
          bbox: [-5.9, 35.6, -5.7, 35.7] as [number, number, number, number],
          outer: [[[-5.9, 35.6], [-5.7, 35.6], [-5.7, 35.7], [-5.9, 35.6]]] as [number, number][][],
          inner: [],
        },
      ],
    ]),
  );

  it("attaches the centroid, bbox and OSM identifiers where a feature exists", () => {
    const c = withGeometry.communes.find((x) => x.codeDigits === "015110519")!;
    expect(c.centroid).toEqual({ lat: 35.66, lng: -5.83 });
    expect(c.bbox).toEqual([-5.9, 35.6, -5.7, 35.7]);
    expect(c.osm).toEqual({ relationId: 424242, wikidata: "Q123" });
    expect(c.provenance.geometry).toBe("osm-odbl");
  });

  it("leaves a commune with no feature null rather than guessing a point", () => {
    const c = withGeometry.communes.find((x) => x.codeDigits !== "015110519")!;
    expect(c.centroid).toBeNull();
    expect(c.bbox).toBeNull();
    expect(c.osm).toBeNull();
    expect(c.provenance.geometry).toBeNull();
  });

  it("takes no name from OpenStreetMap", () => {
    const c = withGeometry.communes.find((x) => x.codeDigits === "015110519")!;
    expect(Object.keys(c.name).sort()).toEqual(["ar", "fr"]);
  });

  it("keeps working with no geometry at all, so the attribute build is unaffected", () => {
    const plain = toRecords(h, units2014);
    expect(plain.communes.length).toBe(1503);
    expect(plain.communes.every((c) => c.centroid === null)).toBe(true);
  });
});

describe("toRecords with the crosswalk", () => {
  it("fills a renumbered commune and marks the basis", () => {
    const target = h.communes.find((c) => c.nameFr === "Commune d'Ait Kamra")!;
    const withCrosswalk = toRecords(h, units2014, new Map(), new Map([
      [target.codeDigits, {
        code2024: target.code,
        codeDigits2024: target.codeDigits,
        code2014: "01.051.05.01",
        name2024: "Ait Kamra",
        name2014: "Ait Kamra",
        nameAr2024: "",
        nameAr2014: "",
        method: "exact_name_in_province" as const,
        evidence: {
          province: "01051",
          normalisedNameMatch: true,
          candidatesInProvince: 1,
          population2024: 10000,
          population2014: 9653,
          populationRatio: 1.036,
        },
      }],
    ]));
    const record = withCrosswalk.communes.find((c) => c.codeDigits === target.codeDigits)!;
    expect(record.population["2014"]?.total).toBe(9653);
    expect(record.population.change?.basis).toBe("crosswalk");
    expect(record.provenance.population2014).toBe("hcp-2014:crosswalk");
  });

  it("prefers a direct code match over the crosswalk", () => {
    const direct = h.communes.find((c) => units2014.has(c.codeDigits))!;
    const withCrosswalk = toRecords(h, units2014, new Map(), new Map([
      [direct.codeDigits, { evidence: { population2014: 1 } } as never],
    ]));
    const record = withCrosswalk.communes.find((c) => c.codeDigits === direct.codeDigits)!;
    expect(record.population.change?.basis).toBe("exact_code");
  });
});
