/**
 * The download page's groups, by the key site/scripts/downloads.ts gives each group of files.
 * site/tests/downloads.test.ts fails on a group of the dataset left out of all of them.
 */
export const DOWNLOAD_GROUPS = {
  places: ["dlCommunes", "dlRegions", "dlProvinces", "dlCercles", "dlArrondissements", "dlCrosswalk"],
  census: ["dlIndicators", "dlIndicators2014", "dlEconomy", "dlHousing", "dlDouars"],
  boundaries: ["dlBoundaries", "dlBoundariesGeojson", "dlOutlines", "dlAdjacency"],
  sources: ["dlSources"],
} as const;
