/**
 * The fields of HCP's 2024 census indicators, each with the heading the workbook gives its
 * column. Kept apart from the parser so the Worker can read the names without bundling an
 * xlsx reader.
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
