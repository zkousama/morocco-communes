import { HOUSING_FIELDS } from "../../../pipeline/src/sources/housingFields.ts";
import type { Topics } from "./indicators.ts";

/** One unit's urban housing file, as data/v1/housing holds it. */
export interface HousingRecord {
  code: string | null;
  codeDigits: string | null;
  level: string;
  name: { fr: string; ar: string | null };
  communeCode?: string;
  topics: Topics;
}

/** Each topic's keys, in the order the workbook gives them. */
export const HOUSING_TOPICS: Map<string, string[]> = new Map();
for (const f of HOUSING_FIELDS) {
  HOUSING_TOPICS.set(f.topic, [...(HOUSING_TOPICS.get(f.topic) ?? []), f.key]);
}
