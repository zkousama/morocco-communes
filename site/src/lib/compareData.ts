/**
 * The compare page's data, written once at build time to /compare/data.json: every commune
 * the site compares, a value per figure, and Morocco's own. A commune whose people mostly
 * aren't in households is left out, as it is from every other comparison, and a figure the
 * two censuses disagree on is left blank for that commune only, as on the home map.
 */
import { MAX_PER_HOUSEHOLD, ordinary } from "../../../api/src/lib/ordinary.ts";
import { mismatches } from "../../../api/src/lib/mismatch.ts";
import { FIGURES, type CompareData, type Figure, type Row } from "./compare";
import { figure, indicatorsOf, national, type IndicatorRecord } from "./indicators";
import { communes, provinces } from "./places";

const tenth = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function read(f: Figure, record: IndicatorRecord, people: number, area: number | null): number | null {
  const s = f.source;
  switch (s.from) {
    case "people":
      return figure(record.people.total?.all, s.path);
    case "women":
      return figure(record.people.total?.female, s.path);
    case "homes":
      return figure(record.households.total, s.path);
    case "ages": {
      let total = 0;
      for (const band of s.bands) {
        const v = figure(record.people.total?.all, `age.${band}`);
        if (v === null) return null;
        total += v;
      }
      return total;
    }
    case "population":
      return people;
    case "density":
      return area ? people / area : null;
  }
}

/** The household figures each census mismatch path blanks. */
const blanks = (record: IndicatorRecord) => new Set(mismatches(record, record["2014"]).map((m) => m.path));
const pathOf = (f: Figure) => ("path" in f.source ? f.source.path : null);

export function compareData(): CompareData {
  const provinceIndex = new Map(provinces.map((p, i) => [p.code, i]));
  const rows: Row[] = [];
  const excluded: CompareData["excluded"] = [];
  for (const c of communes) {
    const record = indicatorsOf.get(c.code);
    if (!record) continue;
    const people = c.population["2024"].total;
    const households = c.population["2024"].households;
    if (!ordinary(people, households)) {
      // Tifariti has both, 38 households for 5,728 people; the people outside households is what matters there.
      const special = !households || people / households > MAX_PER_HOUSEHOLD;
      excluded.push([c.slug, c.name.fr, special ? "special" : "few"]);
      continue;
    }
    const flagged = blanks(record);
    const values = FIGURES.map((f) => {
      const path = pathOf(f);
      if (path && f.source.from === "homes" && flagged.has(path)) return null;
      const v = read(f, record, people, c.areaKm2 ?? null);
      return f.unit === "count" ? v : tenth(v);
    });
    rows.push([c.slug, c.name.fr, c.name.ar, provinceIndex.get(c.parents.province) ?? -1, c.type === "urban" ? "u" : "r", ...values]);
  }
  const area = communes.reduce((s, c) => s + (c.areaKm2 ?? 0), 0);
  const total = communes.reduce((s, c) => s + c.population["2024"].total, 0);
  // Morocco's figures, from HCP's national record. Its population is no commune's, so it has no mark there.
  const morocco = FIGURES.map((f) => (f.unit === "count" ? null : tenth(read(f, national, total, area))));
  return { figures: FIGURES.map((f) => f.id), provinces: provinces.map((p) => p.name.fr), morocco, communes: rows, excluded };
}
