/**
 * The highest qualification people held at the 2014 census, for everyone aged 10 and over,
 * for men and for women. HCP gives two ladders that don't add to each other: a general
 * education one, from primary to a doctorate, and a vocational training one, from an
 * introduction to a specialised technician. Each is a share of the same population, so
 * each sums to 100 on its own, and somebody counted under "no diploma" on one ladder may
 * hold one on the other.
 *
 * The 2024 census publishes the level people reached rather than the diploma they hold,
 * which is the `education` topic here and is not the same question, so none of these
 * carry `comparableTo`.
 */

import type { Sex, Unit } from "./indicatorFields.ts";
import type { Field2014 } from "./indicator2014Fields.ts";

const EVERY: Sex[] = ["all", "male", "female"];
const NOTE =
  "The 2024 census publishes the level of education people reached rather than the diploma they hold, so there is nothing to read this against.";

const field = (topic: string, key: string, label: string, heading: string, unit: Unit, category?: string, note = NOTE): Field2014 => ({
  topic,
  key,
  label,
  heading,
  ...(category ? { category } : {}),
  unit,
  sexes: EVERY,
  ...(note ? { note } : {}),
});

const BASE = "Population âgée de 10 ans et plus";
const GENERAL = "Plus haut diplôme de l'enseignement général";
const VOCATIONAL = "Plus haut diplôme de la formation professionnelle";

const group = (topic: string, heading: string, categories: [key: string, category: string, label: string][]) =>
  categories.map(([key, category, label]) => field(topic, key, label, heading, "percent", category));

/** The sheet, in column order: the count, then the 7 general diplomas, then the 7 vocational. */
export const DIPLOMA_FIELDS_2014: Field2014[] = [
  field("diploma", "population10Plus", "People aged 10 and over", "", "people", BASE, ""),
  ...group("diploma", GENERAL, [
    ["primary", "Primaire", "Primary"],
    ["lowerSecondary", "Secondaire collégial", "Lower secondary"],
    ["upperSecondary", "Secondaire qualifiant", "Upper secondary"],
    ["bachelor", "DEUG, Licence ou équivalent", "DEUG, Licence or equivalent"],
    ["masterOrDoctorate", "Master, Doctorat ou équivalent", "Master's, doctorate or equivalent"],
    ["undeclared", "Diplôme non déclaré", "Diploma not declared"],
    ["none", "Sans diplôme (EG)", "No general-education diploma"],
  ]),
  ...group("vocationalDiploma", VOCATIONAL, [
    ["specialisedTechnician", "Technicien spécialisé", "Specialised technician"],
    ["technician", "Technicien ou Cadre moyen", "Technician or middle manager"],
    ["qualification", "Qualification professionnelle", "Professional qualification"],
    ["specialisation", "Spécialisation professionnelle", "Professional specialisation"],
    ["initiation", "Initiation professionnelle", "Professional initiation"],
    ["undeclared", "Diplôme non déclaré", "Diploma not declared"],
    ["none", "Sans diplôme (FP)", "No vocational diploma"],
  ]),
];
