/**
 * The fields of HCP's douar workbook, the rural population and households of the 2024
 * census by douar.
 *
 * The workbook has 2 sheets of figures, one about people and one about households, each
 * starting with the same 10 columns that place the douar and count it. Every figure after
 * those is a percentage of the douar's people or households, except the count of people
 * aged 15 and over and the distances, which are kilometres.
 *
 * `heading` is the French half of the column's header, which HCP writes in Arabic and
 * French in one cell, joined with the sub-column's where there is one. That's what the
 * parser pins.
 */

export type DouarUnit = "percent" | "people" | "km";

export interface DouarField {
  topic: string;
  key: string;
  /** What it is, in English. */
  label: string;
  heading: string;
  unit: DouarUnit;
}

const field = (topic: string, key: string, label: string, heading: string, unit: DouarUnit = "percent"): DouarField => ({
  topic,
  key,
  label,
  heading,
  unit,
});

/** The columns every sheet starts with, by their French header. */
export const PLACE_HEADINGS = [
  "Code géographique du douar",
  "Région",
  "Préfecture / Province",
  "Cercle",
  "Commune rurale",
  "Fraction",
  "Douar",
  "Type de douar",
  "Nombre de ménages",
  "Population",
];

/** The people sheet, after the first 10 columns. */
export const PEOPLE_FIELDS: DouarField[] = [
  field("nationality", "moroccan", "Moroccan", "Nationalité · Marocaine"),
  field("nationality", "foreign", "Foreign", "Nationalité · Etrangère"),
  field("sex", "male", "Men", "Sexe · Masculin"),
  field("sex", "female", "Women", "Sexe · Féminin"),
  field("age", "under15", "Under 15", "Groupes d’âge · Moins de 15 ans"),
  field("age", "15-59", "Aged 15 to 59", "Groupes d’âge · 15-59 ans"),
  field("age", "60+", "Aged 60 and over", "Groupes d’âge · 60 ans et plus"),
  field("civilRegistration", "registered", "Entered in a family civil-status booklet", "Enregistrement au livret d'état civil"),
  field("maritalStatus", "population15Plus", "Population aged 15 and over", "Population de 15 ans et plus", "people"),
  field("maritalStatus", "single", "Never married", "État matrimonial des 15 ans et plus · Célibataire"),
  field("maritalStatus", "married", "Married", "État matrimonial des 15 ans et plus · Marié"),
  field("maritalStatus", "divorced", "Divorced", "État matrimonial des 15 ans et plus · Divorcé"),
  field("maritalStatus", "widowed", "Widowed", "État matrimonial des 15 ans et plus · Veuf"),
];

/** The households sheet, after the first 10 columns. */
export const HOUSEHOLD_FIELDS: DouarField[] = [
  field("dwellingType", "villa", "Villa, or a floor of one", "Type de logement · Villa ou niveau de villa"),
  field("dwellingType", "apartment", "Apartment", "Type de logement · Appartement"),
  field("dwellingType", "traditionalMoroccanHouse", "Traditional Moroccan house", "Type de logement · Maison marocaine traditionnelle"),
  field("dwellingType", "modernMoroccanHouse", "Modern Moroccan house", "Type de logement · Maison marocaine moderne"),
  field("dwellingType", "basicOrSlum", "Basic house or slum", "Type de logement · Maison sommaire ou bidonville"),
  // HCP's Arabic header for the first of these reads rammed earth or stone; the French one,
  // pinned here, reads solid. The labels follow the French.
  field("dwellingType", "ruralSolid", "Rural dwelling, built solid", "Type de logement · Logement en dur rural"),
  field("dwellingType", "ruralEarth", "Rural dwelling of rammed earth", "Type de logement · Logement en pisé rural"),
  field("dwellingType", "other", "Other", "Type de logement · Autres"),
  field("distanceKm", "pavedRoad", "Average distance to a paved road", "Distance moyenne des logements à la route goudronnée (km)", "km"),
  // An unpaved road: 3,427 of the douars with figures have a paved road nearer than one.
  field("distanceKm", "drivableTrack", "Average distance to an unpaved road a car can drive on", "Distance moyenne des logements à la route carrossable (km)", "km"),
  field("distanceKm", "primarySchool", "Average distance to the nearest primary school", "Distance moyenne des logements à l’école primaire (km)", "km"),
  field("distanceKm", "middleSchool", "Average distance to the nearest collège", "Distance moyenne des logements au collège (km)", "km"),
  field("distanceKm", "highSchool", "Average distance to the nearest lycée", "Distance moyenne des logements au lycée (km)", "km"),
  field("distanceKm", "healthCentre", "Average distance to the nearest health centre or hospital", "Distance moyenne des logements au centre de santé/hôpital (km)", "km"),
];

export const DOUAR_FIELDS = [...PEOPLE_FIELDS, ...HOUSEHOLD_FIELDS];

/** HCP's 3 kinds of douar, by the Arabic the workbook writes and the French its definitions use. */
export const DOUAR_TYPES = {
  grouped: { ar: "دوار مجمع", fr: "Douar groupé" },
  split: { ar: "دوار مجزأ", fr: "Douar éclaté" },
  dispersed: { ar: "دوار مشتت", fr: "Douar dispersé" },
} as const;

export type DouarType = keyof typeof DOUAR_TYPES;
