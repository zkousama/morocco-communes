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
  /** What it is, in English, for a reader who doesn't read HCP's French. */
  label: string;
  /** HCP's heading, as the workbook writes it. */
  heading: string;
  /** The category under the heading, where there is one. */
  category?: string;
  unit: Unit;
  /** The sexes HCP gives it for. Household figures have no sex. */
  sexes: Sex[];
}

const EVERY: Sex[] = ["all", "male", "female"];
const field = (
  topic: string,
  key: string,
  label: string,
  heading: string,
  unit: Unit,
  sexes = EVERY,
  category?: string,
): Field => ({
  topic,
  key,
  label,
  heading,
  unit,
  sexes,
  ...(category ? { category } : {}),
});
const group = (
  topic: string,
  heading: string,
  unit: Unit,
  categories: [key: string, category: string, label: string][],
  sexes = EVERY,
) => categories.map(([key, category, label]) => field(topic, key, label, heading, unit, sexes, category));

const AGE = "Âge quinquennal (%)";
const MARITAL = "État matrimonial des 15 ans et plus (%)";
const READ = "Langues lues et écrites par les alphabètes de 10 ans et plus (non exclusives) (%)";
const EDUCATION = "Niveau d'études dans l'enseignement général (%)";
const LOCAL = "Langues locales utilisées (non exclusives) (%)";
const STATUS = "Statut professionnel des actifs occupés de 15 ans et plus (%)";

/** The people sheets, in column order. A field HCP doesn't give for a sex is skipped in that sex's block. */
export const PEOPLE_FIELDS: Field[] = [
  field("population", "legal", "Legal population", "Population légale", "people", ["all"]),
  field("population", "municipal", "Municipal population", "Population municipale", "people"),
  ...group("sex", "Sexe (%)", "percent", [["male", "Masculin", "Men"], ["female", "Féminin", "Women"]], ["all"]),
  ...group("age", AGE, "percent", [
    ["0-4", "0-4 ans", "Aged 0 to 4"], ["5-9", "5-9 ans", "Aged 5 to 9"], ["10-14", "10-14 ans", "Aged 10 to 14"],
    ["15-19", "15-19 ans", "Aged 15 to 19"], ["20-24", "20-24 ans", "Aged 20 to 24"], ["25-29", "25-29 ans", "Aged 25 to 29"],
    ["30-34", "30-34 ans", "Aged 30 to 34"], ["35-39", "35-39 ans", "Aged 35 to 39"], ["40-44", "40-44 ans", "Aged 40 to 44"],
    ["45-49", "45-49 ans", "Aged 45 to 49"], ["50-54", "50-54 ans", "Aged 50 to 54"], ["55-59", "55-59 ans", "Aged 55 to 59"],
    ["60-64", "60-64 ans", "Aged 60 to 64"], ["65-69", "65-69 ans", "Aged 65 to 69"], ["70-74", "70-74 ans", "Aged 70 to 74"],
    ["75+", "75 ans ou plus", "Aged 75 and over"],
  ]),
  field("maritalStatus", "population15Plus", "Population aged 15 and over", "Population de 15 ans et plus", "people"),
  ...group("maritalStatus", MARITAL, "percent", [
    ["single", "Célibataire", "Never married"], ["married", "Marié.e", "Married"],
    ["divorced", "Divorcé.e", "Divorced"], ["widowed", "Veuf.ve", "Widowed"],
  ]),
  field("maritalStatus", "singulateMeanAgeAtMarriage", "Singulate mean age at marriage", "Âge moyen singulier au mariage", "years"),
  field("fertility", "totalFertilityRate", "Total fertility rate", "Indicateur conjoncturel de fécondité", "births per woman", ["all", "female"]),
  field("fertility", "completedFertility", "Completed fertility, women aged 45 to 49", "Descendance finale des femmes", "births per woman", ["all", "female"]),
  field("disability", "prevalence", "Disability prevalence", "Taux de prévalence du handicap (%)", "percent"),
  field("schooling", "population7to12", "Population aged 7 to 12", "Population de 7-12 ans", "people"),
  field("schooling", "rate6to11", "School enrolment at 6 to 11, in 2023/24", "Taux de scolarisation des 6-11 ans en 2023/2024 (%)", "percent"),
  field("illiteracy", "population10Plus", "Population aged 10 and over", "Population de 10 ans et plus", "people"),
  field("illiteracy", "rate10Plus", "Illiteracy rate, aged 10 and over", "Taux d'analphabétisme des 10 ans et plus (%)", "percent"),
  field("illiteracy", "population15Plus", "Population aged 15 and over", "Population de 15 ans et plus", "people"),
  field("illiteracy", "rate15Plus", "Illiteracy rate, aged 15 and over", "Taux d'analphabétisme des 15 ans et plus (%)", "percent"),
  field("languagesReadAndWritten", "literatePopulation10Plus", "Literate population aged 10 and over", "Population alphabète de 10 ans et plus", "people"),
  ...group("languagesReadAndWritten", READ, "percent", [
    ["arabic", "Arabe", "Arabic"], ["amazighTifinagh", "Amazigh (Tifinagh)", "Amazigh, in Tifinagh"],
    ["english", "Anglais", "English"], ["french", "Français", "French"],
  ]),
  ...group("education", EDUCATION, "percent", [
    ["none", "Aucun niveau d'études", "No schooling"], ["preschool", "Préscolaire", "Preschool"],
    ["primary", "Primaire", "Primary"], ["lowerSecondary", "Secondaire collégial", "Lower secondary"],
    ["upperSecondary", "Secondaire qualifiant", "Upper secondary"], ["higher", "Supérieur", "Higher education"],
  ]),
  ...group("localLanguages", LOCAL, "percent", [
    ["darija", "Darija", "Darija"], ["tachelhit", "Tachelhit", "Tachelhit"], ["tamazight", "Tamazight", "Tamazight"],
    ["tarifit", "Tarifit", "Tarifit"], ["hassania", "Hassania", "Hassania"],
  ]),
  field("labour", "population15Plus", "Population aged 15 and over", "Population de 15 ans et plus", "people"),
  field("labour", "active", "In the labour force, aged 15 and over", "Population active de 15 ans et plus", "people"),
  field("labour", "inactive", "Outside the labour force, aged 15 and over", "Population inactive de 15 ans et plus", "people"),
  field("labour", "activityRate", "Labour force participation rate, aged 15 and over", "Taux d'activité des 15 ans et plus (%)", "percent"),
  field("labour", "unemploymentRate", "Unemployment rate", "Taux de chômage (%)", "percent"),
  field("labour", "employed", "Employed, aged 15 and over", "Population active occupée de 15 ans et plus", "people"),
  ...group("employmentStatus", STATUS, "percent", [
    ["employer", "Employeur", "Employer"], ["selfEmployed", "Indépendant", "Self-employed"],
    ["publicSector", "Salarié du secteur public", "Public sector employee"],
    ["privateSector", "Salarié du secteur privé", "Private sector employee"],
    ["familyWorker", "Aide familial", "Unpaid family worker"], ["apprentice", "Apprenti", "Apprentice"],
    ["cooperativeMember", "Coopérateur/Associé", "Cooperative member or partner"], ["other", "Autre", "Other"],
  ]),
];

const NONE: Sex[] = [];

/** The household sheets, in column order. */
export const HOUSEHOLD_FIELDS: Field[] = [
  field("households", "municipalPopulation", "Municipal population", "Population municipale", "people", NONE),
  field("households", "count", "Households", "Ménages", "households", NONE),
  field("households", "averageSize", "Average household size", "Taille moyenne des ménages", "people per household", NONE),
  field("households", "sedentary", "Sedentary households", "Ménages sédentaires", "households", NONE),
  ...group("dwellingType", "Type de logement (%)", "percent", [
    ["villa", "Villa / Étage de villa", "Villa, or a floor of one"], ["apartment", "Appartement", "Apartment"],
    ["moroccanHouse", "Maison marocaine", "Moroccan house"], ["basicOrSlum", "Maison sommaire / Bidonville", "Basic house or slum"],
    ["rural", "Logement rural", "Rural dwelling"], ["other", "Autre", "Other"],
  ], NONE),
  field("households", "peoplePerRoom", "People per room", "Nombre moyen de personnes par pièce d'habitation", "people per room", NONE),
  ...group("occupancy", "Statut d'occupation du logement (%)", "percent", [
    ["owner", "Propriétaire", "Owner"], ["tenant", "Locataire", "Tenant"], ["other", "Autre", "Other"],
  ], NONE),
  ...group("dwellingAge", "Âge du logement (%)", "percent", [
    ["under10", "Moins de 10 ans", "Under 10 years old"], ["10-19", "10-19 ans", "10 to 19 years old"],
    ["20-49", "20-49 ans", "20 to 49 years old"], ["50+", "50 ans ou plus", "50 years or older"],
  ], NONE),
  ...group("amenities", "Disponibilité des éléments essentiels de confort (%)", "percent", [
    ["kitchen", "Cuisine", "Kitchen"], ["toilet", "W.-C.", "Toilet"], ["bathroom", "Pièce d'eau", "Bathroom or shower room"],
    ["electricity", "Électricité", "Electricity"], ["runningWater", "Eau courante", "Running water"],
  ], NONE),
  ...group("wastewater", "Mode d’évacuation des eaux usées (%)", "percent", [
    ["publicSewer", "Réseau public d'assainissement", "Public sewer"], ["septicTank", "Fosse septique", "Septic tank"],
    ["other", "Autre", "Other"],
  ], NONE),
  ...group("householdWaste", "Mode d’évacuation des déchets ménagers (%)", "percent", [
    ["municipalBin", "Bac à ordures de la commune", "Municipal bin"], ["truck", "Camion de la commune / Camion privé", "Municipal or private truck"],
    ["inTheOpen", "Dans la nature", "Dumped in the open"], ["other", "Autre", "Other"],
  ], NONE),
  ...group("cookingFuel", "Combustible de cuisson utilisé (%)", "percent", [
    ["gas", "Gaz", "Gas"], ["electricity", "Électricité", "Electricity"], ["charcoal", "Charbon", "Charcoal"],
    ["firewood", "Bois énergie", "Firewood"], ["other", "Autre", "Other"],
  ], NONE),
  field("households", "distanceToPavedRoadKm", "Average distance to a paved road", "Distance moyenne des logements à la route goudronnée (Km)", "km", NONE),
];

/**
 * The concept HCP defines a column under, where the column's own heading isn't it.
 *
 * The workbook's definitions sheet names 52 concepts, and most columns carry one of those
 * names as their heading or their category, so they find their definition by it. These
 * don't: the age bands are all the one concept, a salaried worker is defined once for the
 * public sector and the private, and the households' amenities are each defined as a share
 * of settled households. Keyed by `topic.key`, or by topic where every column of it shares
 * the concept. A term here that HCP doesn't define stops the build.
 */
export const HCP_CONCEPT: Record<string, string> = {
  age: "Âge",
  "households.count": "Ménage",
  "households.sedentary": "Ménage sédentaire",
  "households.distanceToPavedRoadKm": "Distance à la route goudronnée",
  "employmentStatus.publicSector": "Salarié",
  "employmentStatus.privateSector": "Salarié",
  "amenities.electricity": "Part des ménages sédentaires disposant de l'électricité",
  "amenities.runningWater": "Part des ménages sédentaires disposant de l'eau courante",
};
