/**
 * Which communes have a tram, train commuters, a weekly souk or foreign residents.
 * The commute and foreign bars are the same ones the commune page's rarity lines use.
 * A weekly souk is a count of places, so a small commune still counts.
 */
import { RARITY_FIGURES, RARITY_FOREIGN, RARITY_PEOPLE, RARITY_SHARE, type RarityFigure } from "./context.ts";
import { count, economyOf } from "./economy.ts";
import { figure, indicatorsOf } from "./indicators.ts";
import { communes, pageOf } from "./places.ts";

/** A list longer than this shows its first rows and folds the rest. */
export const WHERE_FOLD = 30;
export const WHERE_SHOWN = 10;

export interface WhereUnit {
  code: string;
  population: number;
  shares: Partial<Record<RarityFigure, number | null>>;
  souks: number | null;
}

export interface WhereRow {
  code: string;
  name: string;
  route: string;
  value: number;
}

export interface WhereSection {
  id: string;
  rows: WhereRow[];
}

const SECTIONS: { id: string; measure: RarityFigure | "souk" }[] = [
  { id: "tram", measure: "commute.tram" },
  { id: "train", measure: "commute.train" },
  { id: "bus", measure: "commute.bus" },
  { id: "employerTransport", measure: "commute.employerTransport" },
  { id: "taxi", measure: "commute.taxi" },
  { id: "souk", measure: "souk" },
  { id: "foreign", measure: "foreign" },
];

/** One section per figure, each list highest first. A commune with no page is left out. */
export function whereSections(units: WhereUnit[], pageFor: (code: string) => { name: string; route: string } | null): WhereSection[] {
  const sections: WhereSection[] = [];
  for (const section of SECTIONS) {
    const rows: WhereRow[] = [];
    for (const unit of units) {
      const page = pageFor(unit.code);
      if (!page) continue;
      const value = section.measure === "souk" ? unit.souks : unit.shares[section.measure];
      if (value === null || value === undefined) continue;
      if (section.measure === "souk") {
        if (value < 1) continue;
      } else if (unit.population < RARITY_PEOPLE || value < (section.measure === "foreign" ? RARITY_FOREIGN : RARITY_SHARE)) {
        continue;
      }
      rows.push({ code: unit.code, name: page.name, route: page.route, value });
    }
    rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    if (rows.length > 0) sections.push({ id: section.id, rows });
  }
  return sections;
}

/** The seven lists, from the censuses and the establishment count. */
export function whereLists(): WhereSection[] {
  const units = communes.map((commune): WhereUnit => {
    const people = indicatorsOf.get(commune.code)?.people.total?.all;
    const total = commune.population["2024"].total;
    const foreign = commune.population["2024"].foreign;
    const shares: WhereUnit["shares"] = {
      foreign: foreign === null || !total ? null : (foreign / total) * 100,
    };
    for (const measure of RARITY_FIGURES) {
      if (measure === "foreign") continue;
      shares[measure] = figure(people, measure);
    }
    return { code: commune.code, population: total, shares, souks: count(economyOf.get(commune.code), "establishments.weeklySouks") };
  });
  return whereSections(units, (code) => {
    const page = pageOf(code);
    return page ? { name: page.name.fr, route: page.route } : null;
  });
}
