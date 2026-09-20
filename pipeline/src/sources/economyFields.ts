/**
 * The fields of HCP's mapping of economic establishments, made alongside the 2024 census.
 *
 * This is a count of places of business rather than of people, so it stands apart from the
 * census indicators: its unit is an establishment, it leaves agriculture out, and the
 * weekly souks it counts are not establishments at all.
 */

export type EconomyUnit = "establishments" | "jobs" | "souks";

export interface EconomyField {
  topic: string;
  key: string;
  /** What it is, in English. */
  label: string;
  /** HCP's heading, as the workbook writes it. */
  heading: string;
  /** The category under the heading, where there is one. */
  category?: string;
  unit: EconomyUnit;
}

const field = (topic: string, key: string, label: string, heading: string, unit: EconomyUnit, category?: string): EconomyField => ({
  topic,
  key,
  label,
  heading,
  ...(category ? { category } : {}),
  unit,
});

const group = (topic: string, heading: string, unit: EconomyUnit, categories: [key: string, category: string, label: string][]) =>
  categories.map(([key, category, label]) => field(topic, key, label, heading, unit, category));

const BUSINESS = "Nombre d'établissements à but lucratif (entreprises et leurs établissements hors secteur de l'agriculture)";
const SECTOR = "Nombre d'établissements à but lucratif : par secteur d'activité";
const SIZE = "Nombre d'établissements à but lucratif : par classe d'emploi";
const FOUNDED = "Nombre d'établissements à but lucratif : par classe de date de création";

/** The sheet, in column order. */
export const ECONOMY_FIELDS: EconomyField[] = [
  field("establishments", "total", "Establishments mapped", "Nombre total des établissements géoréférencés", "establishments"),
  field("establishments", "publicServices", "Public service establishments", "Nombre d'établissements de services publics", "establishments"),
  field(
    "establishments",
    "nonProfit",
    "Non-profit establishments, in premises of their own",
    "Nombre d'établissements à but non lucratif (Associations opérant dans des locaux indépendants)",
    "establishments",
  ),
  field("establishments", "weeklySouks", "Weekly souks in use", "Nombre de Souks hebodomadaires actifs", "souks"),
  field("establishments", "business", "Businesses", BUSINESS, "establishments", "Nombre d'établissements"),
  field("establishments", "jobs", "Permanent jobs in those businesses", BUSINESS, "jobs", "Emplois permanents occupés par ces établissements"),
  ...group("sector", SECTOR, "establishments", [
    ["industry", "Industrie", "Industry"],
    ["construction", "Construction", "Construction"],
    ["commerce", "Commerce", "Commerce"],
    ["services", "Services", "Services"],
  ]),
  ...group("size", SIZE, "establishments", [
    ["1", "un seul employé", "One person"],
    ["2-3", "2 à 3", "2 to 3 people"],
    ["4-9", "4 à 9", "4 to 9 people"],
    ["10-49", "10 à 49", "10 to 49 people"],
    ["50+", "50 & +", "50 people and over"],
  ]),
  ...group("founded", FOUNDED, "establishments", [
    ["before1956", "Avant 1956", "Before 1956"],
    ["1956-1980", "1956-1980", "1956 to 1980"],
    ["1981-1990", "1981-1990", "1981 to 1990"],
    ["1991-2000", "1991-2000", "1991 to 2000"],
    ["2001-2010", "2001-2010", "2001 to 2010"],
    ["2011-2019", "2011-2019", "2011 to 2019"],
    ["2020+", "2020 et +", "2020 and later"],
  ]),
];

/** The parts of the total, which add to it exactly. */
export const PARTS = ["publicServices", "nonProfit", "business"] as const;

/** Each way the businesses are split, every one of which adds to the business count. */
export const SPLITS = ["sector", "size", "founded"] as const;
