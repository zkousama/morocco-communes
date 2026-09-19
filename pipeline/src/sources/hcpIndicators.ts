import { readSheetRows } from "../lib/xlsx.ts";

/**
 * HCP's demographic and socio-economic indicators from the 2024 census: one workbook, six
 * sheets of figures (people, then households, each for the whole unit, its urban part and
 * its rural part) and three of notes. Every column is listed here with the heading HCP
 * gives it, and the parser refuses a workbook whose headings don't match, so a column that
 * moves upstream fails the build instead of landing under the wrong name.
 */

export type Area = "total" | "urban" | "rural";
export type Sex = "all" | "male" | "female";
export const AREAS: Area[] = ["total", "urban", "rural"];
export const SEXES: Sex[] = ["all", "male", "female"];

export type Unit =
  | "people"
  | "households"
  | "percent"
  | "years"
  | "births per woman"
  | "people per household"
  | "people per room"
  | "km";

export interface Field {
  topic: string;
  key: string;
  /** HCP's heading, as the workbook writes it. */
  heading: string;
  /** The category under the heading, where there is one. */
  category?: string;
  unit: Unit;
  /** The sexes HCP gives it for. Household figures have no sex. */
  sexes: Sex[];
}

const EVERY: Sex[] = ["all", "male", "female"];
const field = (topic: string, key: string, heading: string, unit: Unit, sexes = EVERY, category?: string): Field => ({
  topic,
  key,
  heading,
  unit,
  sexes,
  ...(category ? { category } : {}),
});
const group = (topic: string, heading: string, unit: Unit, categories: [key: string, category: string][], sexes = EVERY) =>
  categories.map(([key, category]) => field(topic, key, heading, unit, sexes, category));

const AGE = "Âge quinquennal (%)";
const MARITAL = "État matrimonial des 15 ans et plus (%)";
const READ = "Langues lues et écrites par les alphabètes de 10 ans et plus (non exclusives) (%)";
const EDUCATION = "Niveau d'études dans l'enseignement général (%)";
const LOCAL = "Langues locales utilisées (non exclusives) (%)";
const STATUS = "Statut professionnel des actifs occupés de 15 ans et plus (%)";

/** The people sheets, in column order. A field HCP doesn't give for a sex is skipped in that sex's block. */
export const PEOPLE_FIELDS: Field[] = [
  field("population", "legal", "Population légale", "people", ["all"]),
  field("population", "municipal", "Population municipale", "people"),
  ...group("sex", "Sexe (%)", "percent", [["male", "Masculin"], ["female", "Féminin"]], ["all"]),
  ...group("age", AGE, "percent", [
    ["0-4", "0-4 ans"], ["5-9", "5-9 ans"], ["10-14", "10-14 ans"], ["15-19", "15-19 ans"],
    ["20-24", "20-24 ans"], ["25-29", "25-29 ans"], ["30-34", "30-34 ans"], ["35-39", "35-39 ans"],
    ["40-44", "40-44 ans"], ["45-49", "45-49 ans"], ["50-54", "50-54 ans"], ["55-59", "55-59 ans"],
    ["60-64", "60-64 ans"], ["65-69", "65-69 ans"], ["70-74", "70-74 ans"], ["75+", "75 ans ou plus"],
  ]),
  field("maritalStatus", "population15Plus", "Population de 15 ans et plus", "people"),
  ...group("maritalStatus", MARITAL, "percent", [
    ["single", "Célibataire"], ["married", "Marié.e"], ["divorced", "Divorcé.e"], ["widowed", "Veuf.ve"],
  ]),
  field("maritalStatus", "singulateMeanAgeAtMarriage", "Âge moyen singulier au mariage", "years"),
  field("fertility", "totalFertilityRate", "Indicateur conjoncturel de fécondité", "births per woman", ["all", "female"]),
  field("fertility", "completedFertility", "Descendance finale des femmes", "births per woman", ["all", "female"]),
  field("disability", "prevalence", "Taux de prévalence du handicap (%)", "percent"),
  field("schooling", "population7to12", "Population de 7-12 ans", "people"),
  field("schooling", "rate6to11", "Taux de scolarisation des 6-11 ans en 2023/2024 (%)", "percent"),
  field("illiteracy", "population10Plus", "Population de 10 ans et plus", "people"),
  field("illiteracy", "rate10Plus", "Taux d'analphabétisme des 10 ans et plus (%)", "percent"),
  field("illiteracy", "population15Plus", "Population de 15 ans et plus", "people"),
  field("illiteracy", "rate15Plus", "Taux d'analphabétisme des 15 ans et plus (%)", "percent"),
  field("languagesReadAndWritten", "literatePopulation10Plus", "Population alphabète de 10 ans et plus", "people"),
  ...group("languagesReadAndWritten", READ, "percent", [
    ["arabic", "Arabe"], ["amazighTifinagh", "Amazigh (Tifinagh)"], ["english", "Anglais"], ["french", "Français"],
  ]),
  ...group("education", EDUCATION, "percent", [
    ["none", "Aucun niveau d'études"], ["preschool", "Préscolaire"], ["primary", "Primaire"],
    ["lowerSecondary", "Secondaire collégial"], ["upperSecondary", "Secondaire qualifiant"], ["higher", "Supérieur"],
  ]),
  ...group("localLanguages", LOCAL, "percent", [
    ["darija", "Darija"], ["tachelhit", "Tachelhit"], ["tamazight", "Tamazight"], ["tarifit", "Tarifit"], ["hassania", "Hassania"],
  ]),
  field("labour", "population15Plus", "Population de 15 ans et plus", "people"),
  field("labour", "active", "Population active de 15 ans et plus", "people"),
  field("labour", "inactive", "Population inactive de 15 ans et plus", "people"),
  field("labour", "activityRate", "Taux d'activité des 15 ans et plus (%)", "percent"),
  field("labour", "unemploymentRate", "Taux de chômage (%)", "percent"),
  field("labour", "employed", "Population active occupée de 15 ans et plus", "people"),
  ...group("employmentStatus", STATUS, "percent", [
    ["employer", "Employeur"], ["selfEmployed", "Indépendant"], ["publicSector", "Salarié du secteur public"],
    ["privateSector", "Salarié du secteur privé"], ["familyWorker", "Aide familial"], ["apprentice", "Apprenti"],
    ["cooperativeMember", "Coopérateur/Associé"], ["other", "Autre"],
  ]),
];

const NONE: Sex[] = [];

/** The household sheets, in column order. */
export const HOUSEHOLD_FIELDS: Field[] = [
  field("households", "municipalPopulation", "Population municipale", "people", NONE),
  field("households", "count", "Ménages", "households", NONE),
  field("households", "averageSize", "Taille moyenne des ménages", "people per household", NONE),
  field("households", "sedentary", "Ménages sédentaires", "households", NONE),
  ...group("dwellingType", "Type de logement (%)", "percent", [
    ["villa", "Villa / Étage de villa"], ["apartment", "Appartement"], ["moroccanHouse", "Maison marocaine"],
    ["basicOrSlum", "Maison sommaire / Bidonville"], ["rural", "Logement rural"], ["other", "Autre"],
  ], NONE),
  field("households", "peoplePerRoom", "Nombre moyen de personnes par pièce d'habitation", "people per room", NONE),
  ...group("occupancy", "Statut d'occupation du logement (%)", "percent", [
    ["owner", "Propriétaire"], ["tenant", "Locataire"], ["other", "Autre"],
  ], NONE),
  ...group("dwellingAge", "Âge du logement (%)", "percent", [
    ["under10", "Moins de 10 ans"], ["10-19", "10-19 ans"], ["20-49", "20-49 ans"], ["50+", "50 ans ou plus"],
  ], NONE),
  ...group("amenities", "Disponibilité des éléments essentiels de confort (%)", "percent", [
    ["kitchen", "Cuisine"], ["toilet", "W.-C."], ["bathroom", "Pièce d'eau"], ["electricity", "Électricité"],
    ["runningWater", "Eau courante"],
  ], NONE),
  ...group("wastewater", "Mode d’évacuation des eaux usées (%)", "percent", [
    ["publicSewer", "Réseau public d'assainissement"], ["septicTank", "Fosse septique"], ["other", "Autre"],
  ], NONE),
  ...group("householdWaste", "Mode d’évacuation des déchets ménagers (%)", "percent", [
    ["municipalBin", "Bac à ordures de la commune"], ["truck", "Camion de la commune / Camion privé"],
    ["inTheOpen", "Dans la nature"], ["other", "Autre"],
  ], NONE),
  ...group("cookingFuel", "Combustible de cuisson utilisé (%)", "percent", [
    ["gas", "Gaz"], ["electricity", "Électricité"], ["charcoal", "Charbon"], ["firewood", "Bois énergie"], ["other", "Autre"],
  ], NONE),
  field("households", "distanceToPavedRoadKm", "Distance moyenne des logements à la route goudronnée (Km)", "km", NONE),
];

/**
 * A cell as HCP publishes it. The workbook's conventional signs: "…" for a figure that
 * has no place there, "." for one that's unavailable.
 */
export type Cell = number | "n/a" | "unavailable";

export interface IndicatorRow {
  /** As HCP writes it, without leading zeros. Null for the national row. */
  code: string | null;
  /** As HCP writes it, footnote asterisk included. */
  label: string;
  people: Record<Area, Record<Sex, Cell[]>>;
  households: Record<Area, Cell[]>;
}

const PEOPLE_SHEETS: Record<Area, number> = { total: 1, urban: 2, rural: 3 };
const HOUSEHOLD_SHEETS: Record<Area, number> = { total: 4, urban: 5, rural: 6 };
const AREA_LABEL: Record<Area, string> = { total: "Ensemble", urban: "Urbain", rural: "Rural" };
const SEX_LABEL: Record<Sex, string> = { all: "Ensemble", male: "Masculin", female: "Féminin" };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function toCell(raw: string | null | undefined, unit: Unit): Cell {
  const text = clean(raw);
  if (text === "…") return "n/a";
  if (text === ".") return "unavailable";
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(text)) throw new Error(`unreadable indicator value: ${JSON.stringify(raw)}`);
  const n = Number(text);
  // Counts are whole numbers; everything else is published to 1 or 2 decimals, and the
  // workbook stores the binary neighbour, 9.3000000000000007 for 9.3.
  return unit === "people" || unit === "households" ? n : Math.round(n * 100) / 100;
}

/** The columns of one sex's block on a people sheet, from its first column. */
const peopleColumns = (sex: Sex) => PEOPLE_FIELDS.filter((f) => f.sexes.includes(sex));

/**
 * Checks a people sheet's headings against PEOPLE_FIELDS: the area in the corner, the sex
 * over each block, and each column's heading and category. Returns where each sex's block
 * starts. A people sheet has three rows of headings.
 */
export function peopleLayout(rows: (string | null)[][], area: Area): Record<Sex, number> {
  const problems: string[] = [];
  if (clean(rows[0]?.[0]) !== `Milieu de résidence : ${AREA_LABEL[area]}`) {
    problems.push(`corner reads ${JSON.stringify(rows[0]?.[0])}`);
  }
  const starts = {} as Record<Sex, number>;
  let col = 2;
  let heading = "";
  for (const sex of SEXES) {
    starts[sex] = col;
    for (const f of peopleColumns(sex)) {
      const sexLabel = clean(rows[0]?.[col]);
      if (sexLabel && sexLabel !== `Sexe : ${SEX_LABEL[sex]}`) problems.push(`column ${col}: sex ${JSON.stringify(sexLabel)}, expected ${SEX_LABEL[sex]}`);
      if (clean(rows[1]?.[col])) heading = clean(rows[1]?.[col]);
      if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
      const category = clean(rows[2]?.[col]);
      if (category !== (f.category ?? "")) problems.push(`column ${col}: category ${JSON.stringify(category)}, expected ${JSON.stringify(f.category ?? "")}`);
      col++;
    }
    // One empty column separates the sexes' blocks.
    if (sex !== "female") {
      if (rows.slice(3).some((r) => clean(r[col]) !== "")) problems.push(`column ${col} should be the empty separator`);
      col++;
    }
  }
  const width = Math.max(...rows.map((r) => r.length));
  if (width !== col) problems.push(`sheet is ${width} columns wide, expected ${col}`);
  if (problems.length > 0) throw new Error(`the ${area} people sheet doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
  return starts;
}

/**
 * Checks a household sheet's headings. Two rows of headings: the heading, then the
 * category. The rural sheet's second row has its first labels out of order ("Ménages
 * population" over the population column), so only the categories are checked there; the
 * first two columns are confirmed by value instead, against the people sheets.
 */
export function householdLayout(rows: (string | null)[][], area: Area): void {
  const problems: string[] = [];
  if (clean(rows[0]?.[0]) !== `Milieu de résidence : ${AREA_LABEL[area]}`) {
    problems.push(`corner reads ${JSON.stringify(rows[0]?.[0])}`);
  }
  let heading = "";
  HOUSEHOLD_FIELDS.forEach((f, i) => {
    const col = 2 + i;
    if (clean(rows[0]?.[col])) heading = clean(rows[0]?.[col]);
    if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
    if (f.category && clean(rows[1]?.[col]) !== f.category) {
      problems.push(`column ${col}: category ${JSON.stringify(clean(rows[1]?.[col]))}, expected ${JSON.stringify(f.category)}`);
    }
  });
  const width = Math.max(...rows.map((r) => r.length));
  if (width !== 2 + HOUSEHOLD_FIELDS.length) problems.push(`sheet is ${width} columns wide, expected ${2 + HOUSEHOLD_FIELDS.length}`);
  if (problems.length > 0) throw new Error(`the ${area} household sheet doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
}

/** The data rows of a sheet: from the national row down, each with a label. */
function dataRows(rows: (string | null)[][]): (string | null)[][] {
  const start = rows.findIndex((r) => clean(r[1]) === "Ensemble du territoire national");
  if (start < 0) throw new Error("no national row");
  return rows.slice(start).filter((r) => clean(r[1]) !== "");
}

export function parseHcpIndicators(bytes: Uint8Array): IndicatorRow[] {
  const people = {} as Record<Area, (string | null)[][]>;
  const starts = {} as Record<Area, Record<Sex, number>>;
  const households = {} as Record<Area, (string | null)[][]>;
  for (const area of AREAS) {
    const sheet = readSheetRows(bytes, PEOPLE_SHEETS[area]);
    starts[area] = peopleLayout(sheet, area);
    people[area] = dataRows(sheet);
    const hSheet = readSheetRows(bytes, HOUSEHOLD_SHEETS[area]);
    householdLayout(hSheet, area);
    households[area] = dataRows(hSheet);
  }

  // The six sheets list the same units in the same order.
  const spine = people.total;
  for (const area of AREAS) {
    for (const [name, sheet] of [[`${area} people`, people[area]], [`${area} households`, households[area]]] as const) {
      if (sheet.length !== spine.length) throw new Error(`the ${name} sheet has ${sheet.length} rows, the total people sheet ${spine.length}`);
      sheet.forEach((r, i) => {
        if (clean(r[0]) !== clean(spine[i]![0]) || clean(r[1]) !== clean(spine[i]![1])) {
          throw new Error(`row ${i} of the ${name} sheet is ${clean(r[0])} ${clean(r[1])}, the total people sheet's ${clean(spine[i]![0])} ${clean(spine[i]![1])}`);
        }
      });
    }
  }

  return spine.map((row, i) => ({
    code: clean(row[0]) || null,
    label: clean(row[1]),
    people: Object.fromEntries(
      AREAS.map((area) => [
        area,
        Object.fromEntries(
          SEXES.map((sex) => [
            sex,
            peopleColumns(sex).map((f, j) => toCell(people[area][i]![starts[area][sex] + j], f.unit)),
          ]),
        ),
      ]),
    ) as IndicatorRow["people"],
    households: Object.fromEntries(
      AREAS.map((area) => [area, HOUSEHOLD_FIELDS.map((f, j) => toCell(households[area][i]![2 + j], f.unit))]),
    ) as IndicatorRow["households"],
  }));
}

export { peopleColumns };
