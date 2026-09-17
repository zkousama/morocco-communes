export type RowKind =
  | "national"
  | "region"
  | "province"
  | "prefecture"
  | "prefectureOfArrondissements"
  | "cercle"
  | "commune"
  | "arrondissement"
  | "urbanCentre";

export interface RawRow {
  kind: RowKind;
  nameFr: string;
  nameAr: string;
  code: string | null;
  population: number | null;
  moroccan: number | null;
  foreign: number | null;
  households: number | null;
}
