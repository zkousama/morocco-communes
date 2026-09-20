/**
 * What the people in work did, at the 2014 census: the occupation group they worked in
 * and the sector they worked for, each as a share of the employed population aged 15 and
 * over, for everyone, for men and for women.
 *
 * The 2024 census publishes neither by commune, so none of these carry `comparableTo`.
 * The sectors are not the establishments' sectors either: these count people by the sector
 * they worked in in 2014, and `economy/` counts workplaces mapped in 2024.
 */

import type { Sex, Unit } from "./indicatorFields.ts";
import type { Field2014 } from "./indicator2014Fields.ts";

const EVERY: Sex[] = ["all", "male", "female"];
const NOTE = "The 2024 census doesn't publish this by commune, so there is nothing to read it against.";

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

const BASE = "Population active occupée âgée de 15 ans et plus";
const PROFESSION = "Grand groupe de professions";
const SECTOR = "Secteur d'activité";

const group = (topic: string, heading: string, categories: [key: string, category: string, label: string][]) =>
  categories.map(([key, category, label]) => field(topic, key, label, heading, "percent", category));

/** The sheet, in column order: the count, then the 10 occupations, then the 9 sectors. */
export const PROFESSION_FIELDS_2014: Field2014[] = [
  field("profession", "employed", "Employed people aged 15 and over", "", "people", BASE, ""),
  ...group("profession", PROFESSION, [
    [
      "managersAndProfessionals",
      "Membres des corps législatifs, élus locaux, responsables hiérarchiques de la fonction publique, directeurs et cadres de direction d'entreprises, cadres supérieurs et membres des professions libérales",
      "Legislators, officials, directors and senior professionals",
    ],
    ["technicians", "Techniciens et professions intermédiaires", "Technicians and associate professionals"],
    ["clerks", "Employés", "Clerical workers"],
    ["traders", "Commerçants et intermédiaires commerciaux et financiers", "Traders, and commercial and financial intermediaries"],
    [
      "farmers",
      "Exploitants agricoles, pêcheurs de poissons et d'autres espèces aquatiques, forestiers, chasseurs et travailleurs assimilés",
      "Farmers, fishers, foresters and hunters",
    ],
    [
      "artisans",
      "Artisans et ouvriers qualifiés des métiers artisanaux (non compris les ouvriers de l'agriculture)",
      "Artisans and skilled craft workers",
    ],
    [
      "farmLabourers",
      "Ouvriers et manœuvres agricoles et de la pêche (y compris les ouvriers qualifiés)",
      "Farm and fishing labourers",
    ],
    [
      "machineOperators",
      "Conducteurs d'installations et de machines et ouvriers de l'assemblage",
      "Plant and machine operators, and assemblers",
    ],
    [
      "labourers",
      "Manœuvres non agricoles, manutentionnaires et travailleurs des petits métiers",
      "Labourers, handlers and people in small trades",
    ],
    ["unclassified", "Travailleurs ne pouvant être classés selon la profession", "Work that couldn't be classified"],
  ]),
  ...group("workSector", SECTOR, [
    ["agriculture", "Agriculture, sylviculture et pêche", "Agriculture, forestry and fishing"],
    ["industry", "Industrie extractives et manufacturières", "Mining and manufacturing"],
    ["utilities", "Eau et électricité", "Water and electricity"],
    ["construction", "Construction", "Construction"],
    ["commerce", "Commerce, réparation d'automobiles et de motocycles", "Commerce, and vehicle repair"],
    ["transport", "Transport, entrepôt et communication", "Transport, warehousing and communication"],
    ["marketServices", "Autres services marchands", "Other market services"],
    ["publicServices", "Administration publique, éducation, santé et action sociale", "Public administration, education, health and social work"],
    ["other", "Activités extraterritoriales et non déclarées", "Extraterritorial and undeclared activity"],
  ]),
];
