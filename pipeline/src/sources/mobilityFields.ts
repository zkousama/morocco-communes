/**
 * How people get to work, from each census, and in 2014 where they work and how children
 * get to school. HCP publishes these apart from the main indicators, one workbook per
 * census, and the fields land on the same records under their own topics.
 *
 * The 2024 workbook counts the sedentary employed population aged 15 and over; the 2014
 * one counts the employed population aged 15 and over, nomads excluded. Eight modes of
 * transport are the same question in both, and carry `comparableTo`.
 */

import type { Sex, Unit } from "./indicatorFields.ts";
import type { Field2014 } from "./indicator2014Fields.ts";

export type MobilityField = Field2014;

const EVERY: Sex[] = ["all", "male", "female"];

const field = (
  topic: string,
  key: string,
  label: string,
  heading: string,
  unit: Unit,
  extra: { category?: string; comparableTo?: string; note?: string; sheetHeading?: string } = {},
): MobilityField => ({
  topic,
  key,
  label,
  heading,
  ...(extra.category ? { category: extra.category } : {}),
  unit,
  sexes: EVERY,
  ...(extra.comparableTo ? { comparableTo: extra.comparableTo } : {}),
  ...(extra.note ? { note: extra.note } : {}),
  ...(extra.sheetHeading ? { sheetHeading: extra.sheetHeading } : {}),
});

const group = (
  topic: string,
  heading: string,
  categories: [key: string, category: string, label: string, comparableTo?: string, note?: string][],
) => categories.map(([key, category, label, comparableTo, note]) => field(topic, key, label, heading, "percent", { category, comparableTo, note }));

const MODE_2024 = "Mode de transport utilisé pour se rendre sur le lieu de travail";
const BASE_2024 = "Population sédentaire active occupée de 15 ans et plus";

/** The 2024 workbook, in column order: the count, then each mode's share. */
export const COMMUTE_FIELDS_2024: MobilityField[] = [
  field("commute", "employed", "Employed people aged 15 and over, settled", BASE_2024, "people"),
  ...group("commute", MODE_2024, [
    ["walking", "À pieds", "On foot"],
    ["bikeOrMotorcycle", "Motocycle/ Bicyclette", "Bicycle or motorcycle"],
    ["privateCar", "Voiture privée", "Private car"],
    ["bus", "Bus", "Bus"],
    ["taxi", "Taxi", "Taxi"],
    ["employerTransport", "Transport de l'employeur / Etablissement", "Transport laid on by the employer"],
    ["train", "Train", "Train"],
    ["tram", "Tram", "Tram"],
    ["informalTransport", "Transport informel", "Informal transport"],
    ["animal", "Animaux", "Animal"],
    ["other", "Autre", "Another way"],
    ["noTravel", "Ne se déplace pas", "Doesn’t travel to work"],
  ]),
];

const WORKPLACE_2014 = "Population active occupée de 15 ans et plus selon le lieu de travail";
const MODE_2014 = "Population active occupée de 15 ans et plus selon le mode de transport utilisé pour se rendre sur le lieu de travail";
const STUDY_PLACE_2014 = "Population scolarisée selon le lieu d'étude";
const STUDY_MODE_2014 = "Population scolarisée selon le mode de transport utilisé pour se rendre sur le lieu d'études";
const SPLIT_OUT = "The 2024 census counts informal transport and animals on their own, which in 2014 fell under this.";

/** The 2014 workbook, in column order: workers, then the school-age population. */
export const MOBILITY_FIELDS_2014: MobilityField[] = [
  // The count opens each sex's block with nothing above it, so HCP's wording for it sits
  // in the category row rather than the heading row.
  field("commute", "employed", "Employed people aged 15 and over", "", "people", {
    category: "Population active occupée de 15 ans et plus",
    note: "The 2024 census counts the settled employed population, which leaves out people who move with the seasons.",
  }),
  ...group("workplace", WORKPLACE_2014, [
    ["atHome", "À domicile", "At home"],
    ["ownNeighbourhood", "Quartier/Douar de résidence", "Their own neighbourhood or douar"],
    ["otherNeighbourhood", "Autre quartier/douar dans la commune de résidence", "Another neighbourhood or douar in their commune"],
    ["otherCommune", "Autre commune dans la province de résidence", "Another commune in their province"],
    ["otherProvince", "Autre province", "Another province"],
    ["noFixedPlace", "Lieu non fixe", "No fixed place"],
    ["elsewhere", "Autre lieu", "Somewhere else"],
    ["undetermined", "Non déterminé", "Not stated"],
  ]),
  ...group("commute", MODE_2014, [
    ["walking", "Marche à pied", "On foot", "commute.walking"],
    ["bikeOrMotorcycle", "Bicyclette / Motocycle", "Bicycle or motorcycle", "commute.bikeOrMotorcycle"],
    ["privateCar", "Voiture privée", "Private car", "commute.privateCar"],
    ["bus", "Bus", "Bus", "commute.bus"],
    ["taxi", "Taxi", "Taxi", "commute.taxi"],
    ["employerTransport", "Transport de personnel", "Transport laid on by the employer", "commute.employerTransport"],
    ["train", "Train", "Train", "commute.train"],
    ["tram", "Tram", "Tram", "commute.tram"],
    ["other", "Autre", "Another way", undefined, SPLIT_OUT],
    ["worksAtHome", "Personne travaillant à son domicile", "Works at home", undefined,
      "The 2024 census asks instead whether a person travels to work at all, which covers more than working at home."],
    ["undetermined", "Non déterminé", "Not stated", undefined, "The 2024 workbook has no such category."],
  ]),
  // The count of people in education sits under the workers' transport heading, which the
  // workbook fills down over it. That heading belongs to the topic above, so it is checked
  // against and not published.
  field("study", "students", "People in education", "", "people", {
    category: "Population scolarisée",
    sheetHeading: MODE_2014,
    note: "Asked in 2014 and not in 2024.",
  }),
  ...group("study", STUDY_PLACE_2014, [
    ["ownNeighbourhood", "Quartier/Douar de résidence", "Their own neighbourhood or douar", undefined, "Asked in 2014 and not in 2024."],
    ["otherNeighbourhood", "Autre quartier/douar dans la commune de résidence", "Another neighbourhood or douar in their commune", undefined, "Asked in 2014 and not in 2024."],
    ["otherCommune", "Autre commune dans la province de résidence", "Another commune in their province", undefined, "Asked in 2014 and not in 2024."],
    ["otherProvince", "Autre province", "Another province", undefined, "Asked in 2014 and not in 2024."],
    ["elsewhere", "Autre lieu", "Somewhere else", undefined, "Asked in 2014 and not in 2024."],
    ["undetermined", "Non déterminé", "Not stated", undefined, "Asked in 2014 and not in 2024."],
  ]),
  ...group("studyCommute", STUDY_MODE_2014, [
    ["walking", "Marche à pied", "On foot", undefined, "Asked in 2014 and not in 2024."],
    ["bikeOrMotorcycle", "Bicyclette / Motocycle", "Bicycle or motorcycle", undefined, "Asked in 2014 and not in 2024."],
    ["privateCar", "Voiture privée", "Private car", undefined, "Asked in 2014 and not in 2024."],
    ["bus", "Bus", "Bus", undefined, "Asked in 2014 and not in 2024."],
    ["taxi", "Taxi", "Taxi", undefined, "Asked in 2014 and not in 2024."],
    ["schoolTransport", "Transport scolaire", "School transport", undefined, "Asked in 2014 and not in 2024."],
    ["train", "Train", "Train", undefined, "Asked in 2014 and not in 2024."],
    ["tram", "Tram", "Tram", undefined, "Asked in 2014 and not in 2024."],
    ["other", "Autre", "Another way", undefined, "Asked in 2014 and not in 2024."],
    ["undetermined", "Non déterminé", "Not stated", undefined, "Asked in 2014 and not in 2024."],
  ]),
];
