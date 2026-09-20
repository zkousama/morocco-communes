/**
 * The dataset's own version, independent of the API's. Major for a breaking schema
 * change, minor for an added field, patch for a correction. Bumped deliberately.
 */
export const DATASET_VERSION = "1.8.0";

export interface SourceSpec {
  id: string;
  url: string;
  filename: string;
  licence: string;
}

export const SOURCES: SourceSpec[] = [
  {
    id: "hcp-2024",
    url: "https://www.hcp.ma/file/242341/",
    filename: "hcp-population-legale-2024.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2024. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2024-indicators",
    url: "https://www.hcp.ma/file/242671/",
    filename: "hcp-indicateurs-2024.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2024, Indicateurs démographiques et socioéconomiques. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2014",
    url: "https://www.hcp.ma/file/230057/",
    filename: "hcp-population-legale-2014.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2014-indicators-people",
    url: "https://www.hcp.ma/file/230045/",
    filename: "hcp-indicateurs-2014-population.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014, Indicateurs démographiques et socioéconomiques de la population. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2014-indicators-households",
    url: "https://www.hcp.ma/file/230042/",
    filename: "hcp-indicateurs-2014-menages.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014, Indicateurs sur les ménages et les conditions d'habitation. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2024-commute",
    url: "https://www.hcp.ma/file/248301/",
    filename: "hcp-transport-2024.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2024, Indicateurs communaux sur le mode de transport domicile-lieu de travail des actifs occupés. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2014-mobility",
    url: "https://www.hcp.ma/file/230011/",
    filename: "hcp-mobilite-2014.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014, Indicateurs sur la mobilité et le transport par commune. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2024-establishments",
    url: "https://www.hcp.ma/file/242672/",
    filename: "hcp-etablissements-2024.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2024, Cartographie des établissements économiques. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2014-professions",
    url: "https://www.hcp.ma/file/230028/",
    filename: "hcp-professions-2014.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014, Indicateurs sur les professions et les secteurs d'activité de la population active occupée. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2014-diplomas",
    url: "https://www.hcp.ma/file/230031/",
    filename: "hcp-diplomes-2014.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014, Indicateurs sur les diplômes de la population. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
  {
    id: "hcp-2024-housing",
    url: "https://www.hcp.ma/file/246208/",
    filename: "hcp-logement-urbain-2024.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2024, Indicateurs communaux du parc logement urbain. Reusable, commercially too, on CC BY 4.0 terms: credit HCP and say what was changed. https://www.hcp.ma/Conditions-generales-d-utilisation-Version-1-0_a2194.html",
  },
];
