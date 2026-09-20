import { ECONOMY_FIELDS } from "../../../pipeline/src/sources/economyFields.ts";
import type { Topics } from "./indicators.ts";

/** One unit's establishments file, as data/v1/economy holds it. */
export interface EconomyRecord {
  code: string | null;
  codeDigits: string | null;
  level: string;
  name: { fr: string; ar: string | null };
  communeCode?: string;
  /** Set on the 6 cities the workbook counts by arrondissement: their figures are summed. */
  basis?: "arrondissement_sum";
  topics: Topics;
}

/**
 * The figures a list of communes can be sorted by, each under an `economy.` prefix: the
 * census counts people and this counts workplaces, so `economy.establishments.jobs` says
 * which of the two a path is asking for.
 */
export const ECONOMY_PATHS: string[] = ECONOMY_FIELDS.map((f) => `economy.${f.topic}.${f.key}`);

/** Each topic's keys, in HCP's order. */
export const ECONOMY_TOPICS: Map<string, string[]> = new Map();
for (const f of ECONOMY_FIELDS) {
  ECONOMY_TOPICS.set(f.topic, [...(ECONOMY_TOPICS.get(f.topic) ?? []), f.key]);
}

/** Why an `economy.` path isn't one, in words a model can act on. */
export function economyProblem(raw: string): string | null {
  if (ECONOMY_PATHS.includes(raw)) return null;
  if (ECONOMY_RATIOS.some((r) => r.path === raw)) return null;
  if (/^economy\.(per1000|perBusiness)\./.test(raw)) {
    return `${raw} isn't one of the figures worked out from the counts; they are ${ECONOMY_RATIOS.map((r) => r.path).join(", ")}`;
  }
  const [, topic, key] = /^economy\.([^.]*)\.?(.*)$/.exec(raw) ?? [];
  const keys = ECONOMY_TOPICS.get(topic ?? "");
  if (keys) return `economy.${topic} has no ${key || "key"}; its keys are ${keys.join(", ")}`;
  return `${raw} isn't an establishment figure; the topics are ${[...ECONOMY_TOPICS.keys()].map((t) => `economy.${t}`).join(", ")}`;
}

/**
 * Figures the workbook doesn't hold, worked out from two that it does. A count on its own
 * ranks the biggest places first, which says more about their size than about them, so
 * these put a count against the people it serves or the businesses it belongs to. They are
 * worked out per request rather than published, and a row sorted by one says the division
 * it came from.
 */
export interface EconomyRatio {
  path: string;
  /** The count on top, by its `ECONOMY_PATHS` path. */
  of: string;
  /** What it is divided by: the 2024 population, or the unit's own business count. */
  per: "population" | "business";
  /** What the division is, in words, for the row it lands on. */
  derived: string;
}

export const ECONOMY_RATIOS: EconomyRatio[] = [
  {
    path: "economy.per1000.establishments",
    of: "economy.establishments.total",
    per: "population",
    derived: "establishments mapped ÷ 2024 population × 1,000",
  },
  {
    path: "economy.per1000.jobs",
    of: "economy.establishments.jobs",
    per: "population",
    derived: "permanent jobs ÷ 2024 population × 1,000",
  },
  {
    path: "economy.perBusiness.jobs",
    of: "economy.establishments.jobs",
    per: "business",
    derived: "permanent jobs ÷ businesses",
  },
];

/** A unit's figures in the order of `ECONOMY_PATHS`. */
export const economyValues = (record: EconomyRecord | undefined): (number | null)[] =>
  ECONOMY_FIELDS.map((f) => record?.topics[f.topic]?.[f.key] ?? null);
