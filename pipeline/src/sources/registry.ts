/**
 * The dataset's own version, independent of the API's. Major for a breaking schema
 * change, minor for an added field, patch for a correction. Bumped deliberately.
 */
export const DATASET_VERSION = "1.0.0";

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
    licence: "Haut-Commissariat au Plan, RGPH 2024. Government publication, attributed.",
  },
  {
    id: "hcp-2014",
    url: "https://www.hcp.ma/file/230057/",
    filename: "hcp-population-legale-2014.xlsx",
    licence: "Haut-Commissariat au Plan, RGPH 2014. Government publication, attributed.",
  },
];
