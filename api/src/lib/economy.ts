import { ECONOMY_FIELDS } from "../../../pipeline/src/sources/economyFields.ts";
import type { Topics } from "./indicators.ts";

/** One unit's establishments file, as data/v1/economy holds it. */
export interface EconomyRecord {
  code: string | null;
  codeDigits: string | null;
  level: string;
  name: { fr: string; ar: string | null };
  communeCode?: string;
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
  const [, topic, key] = /^economy\.([^.]*)\.?(.*)$/.exec(raw) ?? [];
  const keys = ECONOMY_TOPICS.get(topic ?? "");
  if (keys) return `economy.${topic} has no ${key || "key"}; its keys are ${keys.join(", ")}`;
  return `${raw} isn't an establishment figure; the topics are ${[...ECONOMY_TOPICS.keys()].map((t) => `economy.${t}`).join(", ")}`;
}

/** A unit's figures in the order of `ECONOMY_PATHS`. */
export const economyValues = (record: EconomyRecord | undefined): (number | null)[] =>
  ECONOMY_FIELDS.map((f) => record?.topics[f.topic]?.[f.key] ?? null);
