/**
 * The fields of HCP's urban housing stock, published alongside the 2024 census.
 *
 * It counts dwellings rather than households, and only in urban areas, so it stands apart
 * from the census indicators: those give the dwelling a household lives in, for the whole
 * country. A vacant flat is in here and in no household's record.
 *
 * Every figure but the count of dwellings is a percentage of the urban dwellings of that
 * unit. `heading` is the workbook's own wording for the column, read down its merged
 * header rows and joined, which is what the parser pins.
 */

export type HousingUnit = "dwellings" | "percent";

export interface HousingField {
  topic: string;
  key: string;
  /** What it is, in English. */
  label: string;
  /** The workbook's header cells for the column, top to bottom. */
  heading: string;
  unit: HousingUnit;
}

const field = (topic: string, key: string, label: string, heading: string, unit: HousingUnit = "percent"): HousingField => ({
  topic,
  key,
  label,
  heading,
  unit,
});

const AGE: [category: string, suffix: string, label: string][] = [
  ["Moins de 20 ans", "Under20", "under 20 years old"],
  ["De 20 à moins de 50 ans", "20to49", "20 to 49 years old"],
  ["50 ans et plus", "50Plus", "50 years or older"],
];

/**
 * The 27 columns that cross the age bands with the type of dwelling. HCP merges the type
 * across each run of three and leaves a stray "2" and "3" in the second and third cells,
 * except in the first run, where it leaves them empty.
 */
const ageOf = (key: string, label: string, first: string, stray = true): HousingField[] =>
  AGE.map(([category, suffix, band], i) =>
    field(
      "ageByType",
      `${key}${suffix}`,
      `${label}, ${band}`,
      i === 0 ? `${first} · ${category}` : stray ? `${i + 1} · ${category}` : category,
    ),
  );

/** The sheet, in column order, from the total of dwellings to the housing deficit. */
export const HOUSING_FIELDS: HousingField[] = [
  field("dwellings", "total", "Urban dwellings", "Total des logements urbains", "dwellings"),

  field("occupancy", "occupied", "Occupied", "Nature d'occupation % · Logement occupé"),
  field("occupancy", "vacant", "Vacant", "Logement non occupé · Logement vacants"),
  field("occupancy", "seasonal", "Second or seasonal home", "Logement secondaire/saisonnier"),
  field("occupancy", "unoccupied", "Unoccupied, of either kind", "Total logement non occupé"),

  field("type", "villa", "Villa, or a floor of one", "Type de logement % · Logement non précaire ou salubre · Villa ou niveau de villa"),
  field("type", "apartment", "Apartment", "Appartement"),
  field("type", "traditional", "Traditional Moroccan house", "Maison marocaine traditionnelle"),
  field("type", "modern", "Modern Moroccan house", "Maison marocaine moderne"),
  field("type", "sound", "Sound housing, all told", "Total non précaire"),
  field("type", "slum", "Basic house or slum", "Logement précaire · Maison sommaire ou bidonville"),
  field("type", "ruralType", "Rural-type dwelling", "Logement en type rural"),
  field("type", "other", "Other", "Autres type"),
  field("type", "precarious", "Precarious housing, all told", "Total précaire"),

  field("age", "under20", "Under 20 years old", "Age de logement % · Moins de 20 ans"),
  field("age", "20-49", "20 to 49 years old", "De 20 à moins de 50 ans"),
  field("age", "50+", "50 years or older", "50 ans et plus"),

  ...ageOf("villa", "Villa", "Age du logement selon le type Type · Logement non précaire ou salubre · Villa ou niveau de villa", false),
  ...ageOf("apartment", "Apartment", "Appartement"),
  ...ageOf("traditional", "Traditional Moroccan house", "Maison marocaine traditionnelle"),
  ...ageOf("modern", "Modern Moroccan house", "Maison marocaine moderne"),
  ...ageOf("sound", "Sound housing", "Total non précaire"),
  ...ageOf("slum", "Basic house or slum", "Type de logement précaire % · Logement précaire · Maison sommaire ou bidonville"),
  ...ageOf("ruralType", "Rural-type dwelling", "Logement en type rural"),
  ...ageOf("other", "Other", "Autres type"),
  ...ageOf("precarious", "Precarious housing", "Total précaire"),

  field("walls", "concreteOrBrick", "Reinforced concrete, or brick laid in mortar", "Matériaux de construction des murs % · Béton armé, briques avec mortier"),
  field("walls", "stone", "Stone laid in mortar", "Pierre agglomérée avec mortier"),
  field("walls", "other", "Other", "Autres"),

  field("roofs", "slab", "Concrete slab", "Matériaux de construction des toits % · Dalle"),
  field("roofs", "woodOrTiles", "Boards, wood or tiles", "Planches, bois ou tuiles"),
  field("roofs", "sheetMetal", "Cement or zinc sheeting", "Tôle en ciment ou en zinc"),
  field("roofs", "other", "Other", "Autres"),

  field("networks", "electricity", "On the public electricity network", "Raccordement aux services de base · Réseau public d'électricité"),
  field("networks", "water", "On the public water network", "Réseau public d'eau"),
  field("networks", "sewerage", "On the public sewerage network", "Réseau public d'assainissement"),

  field("dwellings", "deficitRate", "Housing shortfall", "Taux de déficit quantitatif en logement (%)"),
];

/** The types that make up sound housing, and the ones that make up precarious housing. */
export const SOUND = ["villa", "apartment", "traditional", "modern"] as const;
export const PRECARIOUS = ["slum", "ruralType", "other"] as const;
/** Every type the age cross-tab covers, in the order the workbook gives them. */
export const TYPES = [...SOUND, "sound", ...PRECARIOUS, "precarious"] as const;
