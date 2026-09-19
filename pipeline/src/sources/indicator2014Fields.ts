/**
 * The fields of HCP's 2014 census indicators, each with the heading the workbook gives its
 * column, and the 2024 field it can be read against where the question is the same.
 *
 * `comparableTo` is the whole point of this file. Ten of the topics ask what they asked in
 * 2024 and their figures subtract; the rest changed base or categories between the two
 * censuses, and each of those carries the reason in `note`, so a reader who subtracts them
 * anyway knows what they are getting.
 */

import type { Sex, Unit } from "./indicatorFields.ts";

export interface Field2014 {
  topic: string;
  key: string;
  /** What it is, in English, for a reader who doesn't read HCP's French. */
  label: string;
  /** HCP's heading, as the 2014 workbook writes it. */
  heading: string;
  /** The category under the heading, where there is one. */
  category?: string;
  unit: Unit;
  /** The sexes HCP gives it for. Household figures have no sex. */
  sexes: Sex[];
  /** The 2024 field that measures the same thing, as topic.key. */
  comparableTo?: string;
  /** What differs, for a field that looks comparable and isn't. */
  note?: string;
}

const EVERY: Sex[] = ["all", "male", "female"];
const NONE: Sex[] = [];

interface Extra {
  category?: string;
  sexes?: Sex[];
  comparableTo?: string;
  note?: string;
}

const field = (topic: string, key: string, label: string, heading: string, unit: Unit, extra: Extra = {}): Field2014 => ({
  topic,
  key,
  label,
  heading,
  ...(extra.category ? { category: extra.category } : {}),
  unit,
  sexes: extra.sexes ?? EVERY,
  ...(extra.comparableTo ? { comparableTo: extra.comparableTo } : {}),
  ...(extra.note ? { note: extra.note } : {}),
});

const group = (
  topic: string,
  heading: string,
  unit: Unit,
  categories: [key: string, category: string, label: string, comparableTo?: string][],
  extra: Extra = {},
) =>
  categories.map(([key, category, label, comparableTo]) =>
    field(topic, key, label, heading, unit, { ...extra, category, comparableTo }),
  );

const AGE = "Répartition selon le groupe d'âges quinquennal";
const MARITAL = "État matrimonial";
const READ = "Population alphabétisée de 10 ans et plus selon les langues lues et écrites";
const EDUCATION = "Niveau d'études";
const LOCAL = "Langues locales utilisées (non exclusives)";
const ACTIVITY = "Population selon l'activité";
const STATUS = "Situation dans la profession des actifs occupés et des chômeurs ayant déjà travaillé";

/** Everyone, not just the adults 2024 counts. */
const ALL_AGES = "In 2014 HCP published this over the whole population, children included; the 2024 figure counts only people aged 15 and over.";

/** The people sheets, in column order. The male and female blocks repeat all but the first. */
export const PEOPLE_FIELDS_2014: Field2014[] = [
  field("population", "legal", "Legal population", "Population légale", "people", {
    sexes: ["all"],
    comparableTo: "population.legal",
  }),
  field("population", "municipal", "Municipal population", "Population municipale", "people", {
    comparableTo: "population.municipal",
  }),
  ...group("age", AGE, "percent", [
    ["0-4", "0-4 ans", "Aged 0 to 4", "age.0-4"], ["5-9", "5-9 ans", "Aged 5 to 9", "age.5-9"],
    ["10-14", "10-14 ans", "Aged 10 to 14", "age.10-14"], ["15-19", "15-19 ans", "Aged 15 to 19", "age.15-19"],
    ["20-24", "20-24 ans", "Aged 20 to 24", "age.20-24"], ["25-29", "25-29 ans", "Aged 25 to 29", "age.25-29"],
    ["30-34", "30-34 ans", "Aged 30 to 34", "age.30-34"], ["35-39", "35-39 ans", "Aged 35 to 39", "age.35-39"],
    ["40-44", "40-44 ans", "Aged 40 to 44", "age.40-44"], ["45-49", "45-49 ans", "Aged 45 to 49", "age.45-49"],
    ["50-54", "50-54 ans", "Aged 50 to 54", "age.50-54"], ["55-59", "55-59 ans", "Aged 55 to 59", "age.55-59"],
    ["60-64", "60-64 ans", "Aged 60 to 64", "age.60-64"], ["65-69", "65-69 ans", "Aged 65 to 69", "age.65-69"],
    ["70-74", "70-74 ans", "Aged 70 to 74", "age.70-74"], ["75+", "75 ans et plus", "Aged 75 and over", "age.75+"],
  ]),
  ...group("maritalStatus", MARITAL, "percent", [
    ["single", "Célibataire", "Never married"], ["married", "Marié", "Married"],
    ["divorced", "Divorcé", "Divorced"], ["widowed", "Veuf", "Widowed"],
  ], { note: ALL_AGES }),
  field("maritalStatus", "singulateMeanAgeAtMarriage", "Singulate mean age at marriage", "Âge moyen au premier mariage", "years", {
    comparableTo: "maritalStatus.singulateMeanAgeAtMarriage",
  }),
  field("disability", "prevalence", "Disability prevalence", "Taux de prévalence du handicap", "percent", {
    comparableTo: "disability.prevalence",
  }),
  field("fertility", "completedFertility", "Completed fertility, women aged 45 to 49", "Fécondité", "births per woman", {
    category: "Parité moyenne à 45-49 ans",
    comparableTo: "fertility.completedFertility",
  }),
  field("fertility", "totalFertilityRate", "Total fertility rate", "Fécondité", "births per woman", {
    category: "Indice synthétique de fécondité",
    comparableTo: "fertility.totalFertilityRate",
  }),
  field("schooling", "rate7to12", "School enrolment at 7 to 12", "Taux de scolarisation des enfants âgés de 7 à 12 ans", "percent", {
    note: "The 2024 census published enrolment for children aged 6 to 11, a year younger at each end.",
  }),
  field("illiteracy", "rate10Plus", "Illiteracy rate, aged 10 and over", "Taux d'analphabétisme", "percent", {
    comparableTo: "illiteracy.rate10Plus",
  }),
  ...group("languageCombinations", READ, "percent", [
    ["arabicOnly", "Arabe seule", "Arabic only"],
    ["arabicAndFrench", "Arabe et français seules", "Arabic and French"],
    ["arabicFrenchEnglish", "Arabe, français et anglais", "Arabic, French and English"],
    ["other", "Autres", "Other combinations"],
  ], {
    note: "2014 counted each literate person once, under the combination they read and write. The 2024 census asked about each language separately, so a person can appear under several.",
  }),
  ...group("education", EDUCATION, "percent", [
    ["none", "Néant", "No schooling", "education.none"],
    ["preschool", "Préscolaire", "Preschool", "education.preschool"],
    ["primary", "Primaire", "Primary", "education.primary"],
    ["lowerSecondary", "Secondaire collégial", "Lower secondary", "education.lowerSecondary"],
    ["upperSecondary", "Secondaire qualifiant", "Upper secondary", "education.upperSecondary"],
    ["higher", "Supérieur", "Higher education", "education.higher"],
  ]),
  ...group("localLanguages", LOCAL, "percent", [
    ["darija", "Darija", "Darija", "localLanguages.darija"],
    ["tachelhit", "Tachelhit", "Tachelhit", "localLanguages.tachelhit"],
    ["tamazight", "Tamazight", "Tamazight", "localLanguages.tamazight"],
    ["tarifit", "Tarifit", "Tarifit", "localLanguages.tarifit"],
    ["hassania", "Hassania", "Hassania", "localLanguages.hassania"],
  ]),
  field("labour", "active", "In the labour force, aged 15 and over", ACTIVITY, "people", {
    category: "Population Active",
    comparableTo: "labour.active",
  }),
  field("labour", "inactive", "Outside the labour force", ACTIVITY, "people", {
    category: "Population Inactive",
    note: "The 2014 count is everyone else, children included. The 2024 count starts at 15, like the labour force itself.",
  }),
  field("labour", "activityRate", "Labour force participation rate, aged 15 and over", "Taux net d'activité", "percent", {
    comparableTo: "labour.activityRate",
  }),
  field("labour", "unemploymentRate", "Unemployment rate", "Taux de chômage", "percent", {
    comparableTo: "labour.unemploymentRate",
  }),
  ...group("employmentStatus", STATUS, "percent", [
    ["employer", "Employeur", "Employer"], ["selfEmployed", "Indépendant", "Self-employed"],
    ["publicSector", "Salarié dans le secteur public", "Public sector employee"],
    ["privateSector", "Salarié dans le secteur privé", "Private sector employee"],
    ["familyWorker", "Aide familiale", "Unpaid family worker"], ["apprentice", "Apprenti", "Apprentice"],
    ["cooperativeMember", "Associé ou partenaire", "Cooperative member or partner"], ["other", "Autre", "Other"],
  ], {
    note: "The 2014 shares cover people in work and unemployed people who had worked before. The 2024 shares cover people in work.",
  }),
];

/** The household sheets, in column order, from the second column of figures. */
export const HOUSEHOLD_FIELDS_2014: Field2014[] = [
  field("households", "municipalPopulation", "Municipal population", "Population et ménages", "people", {
    category: "Population municipale",
    sexes: NONE,
    comparableTo: "households.municipalPopulation",
  }),
  field("households", "count", "Households", "Population et ménages", "households", {
    category: "Ménage",
    sexes: NONE,
    comparableTo: "households.count",
  }),
  field("households", "averageSize", "Average household size", "Population et ménages", "people per household", {
    category: "Taille moyenne",
    sexes: NONE,
    comparableTo: "households.averageSize",
  }),
  ...group("dwellingType", "Type de logement", "percent", [
    ["villa", "Villa", "Villa, or a floor of one", "dwellingType.villa"],
    ["apartment", "Appartement", "Apartment", "dwellingType.apartment"],
    ["moroccanHouse", "Maison marocaine", "Moroccan house", "dwellingType.moroccanHouse"],
    ["basicOrSlum", "Habitat sommaire", "Basic house or slum", "dwellingType.basicOrSlum"],
    ["rural", "Logement de type rural", "Rural dwelling", "dwellingType.rural"],
    ["other", "Autre", "Other", "dwellingType.other"],
  ], { sexes: NONE }),
  field("households", "peoplePerRoom", "People per room", "Taux d'occupation", "people per room", {
    sexes: NONE,
    comparableTo: "households.peoplePerRoom",
  }),
  ...group("occupancy", "Statut d'occupation", "percent", [
    ["owner", "Propriétaire", "Owner", "occupancy.owner"],
    ["tenant", "Locataire", "Tenant", "occupancy.tenant"],
    ["other", "Autre", "Other", "occupancy.other"],
  ], { sexes: NONE }),
  ...group("dwellingAge", "Ancienneté du logement", "percent", [
    ["under10", "Moins de 10 ans", "Under 10 years old", "dwellingAge.under10"],
    ["10-19", "Entre 10 et 19 ans", "10 to 19 years old", "dwellingAge.10-19"],
    ["20-49", "Entre 20 et 49 ans", "20 to 49 years old", "dwellingAge.20-49"],
    ["50+", "50 ans et plus", "50 years or older", "dwellingAge.50+"],
  ], { sexes: NONE }),
  ...group("amenities", "Équipements de base du logement", "percent", [
    ["kitchen", "Cuisine", "Kitchen", "amenities.kitchen"],
    ["toilet", "W.-C.", "Toilet", "amenities.toilet"],
    ["bathroom", "Bain", "Bathroom or shower room", "amenities.bathroom"],
    ["electricity", "Électricité", "Electricity", "amenities.electricity"],
    ["runningWater", "Eau courante", "Running water", "amenities.runningWater"],
  ], { sexes: NONE }),
  ...group("wastewater", "Mode d'évacuation des eaux usées", "percent", [
    ["publicSewer", "Réseau public", "Public sewer", "wastewater.publicSewer"],
    ["septicTank", "Fosse septique", "Septic tank", "wastewater.septicTank"],
    ["other", "Autre", "Other", "wastewater.other"],
  ], { sexes: NONE }),
  ...group("householdWaste", "Mode d'évacuation des déchets ménagers", "percent", [
    ["municipalBin", "Bac à ordures de la commune", "Municipal bin", "householdWaste.municipalBin"],
    ["truck", "Camion commun ou privé", "Municipal or private truck", "householdWaste.truck"],
    ["otherOrOpen", "Autre", "Dumped in the open, or another way"],
  ], { sexes: NONE }),
  ...group("cookingFuel", "Mode de cuisson fréquemment utilisé", "percent", [
    ["gas", "Gaz", "Gas"], ["electricity", "Électricité", "Electricity"], ["charcoal", "Charbon", "Charcoal"],
    ["firewood", "Bois", "Firewood"], ["animalWaste", "Déchets des animaux", "Animal dung"],
  ], {
    sexes: NONE,
    note: "A 2014 household counts under every fuel it used, so these shares pass 100. The 2024 census recorded one fuel per household.",
  }),
  ...group("equipment", "Autres équipements ménagers", "percent", [
    ["television", "Télévision", "Television"], ["radio", "Radio", "Radio"],
    ["mobilePhone", "Téléphone portable", "Mobile phone"], ["landline", "Téléphone fixe", "Landline"],
    ["internet", "Internet", "Internet at home"], ["computer", "Ordinateur", "Computer"],
    ["satelliteDish", "Parabole", "Satellite dish"], ["refrigerator", "Réfrigérateur", "Refrigerator"],
  ], { sexes: NONE }),
  field("households", "distanceToPavedRoadKm", "Average distance to a paved road", "Distance à la route goudronnée", "km", {
    sexes: NONE,
    comparableTo: "households.distanceToPavedRoadKm",
  }),
];
