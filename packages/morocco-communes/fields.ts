/** The fields of each list, in order. The tests hold the build to it, and the docs page lists it. */
export const FIELDS = {
  regions: ["code", "name", "population"],
  provinces: ["code", "name", "type", "region", "population"],
  cercles: ["code", "name", "region", "province", "population"],
  communes: ["code", "slug", "name", "type", "region", "province", "cercle", "population", "population2014"],
  arrondissements: ["code", "name", "commune", "population"],
} as const;
