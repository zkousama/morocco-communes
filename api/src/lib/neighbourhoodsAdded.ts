/**
 * Neighbourhoods OpenStreetMap doesn't map as places, added by hand. Each is a name in
 * documented use, with a point from a public source; the script that writes the list
 * places it in its arrondissement or commune the same way as the rest, so nothing here
 * says which unit it's in. Short on purpose, like the exonyms: a name earns a line when
 * someone looks for it and doesn't find it.
 */
export interface AddedNeighbourhood {
  fr: string;
  ar: string;
  lat: number;
  lng: number;
  /** Where the name, the Arabic and the point come from, so the entry can be checked. */
  origin: string;
}

export const ADDED: AddedNeighbourhood[] = [
  {
    fr: "Malabata",
    ar: "ملابطا",
    lat: 35.773,
    lng: -5.77,
    origin:
      "Poste Maroc's postcodes of neighbourhoods (data.gov.ma, 2018) list Quartier Malabata in Tanger; the point is Malabata Mall in OpenStreetMap (way 1311556575); the Arabic is OpenStreetMap's (node 4793814229)",
  },
  {
    fr: "Derb Sultan",
    ar: "درب السلطان",
    lat: 33.568092,
    lng: -7.605028,
    origin: "Wikidata Q3023564, a neighbourhood of Casablanca, with its French and Arabic labels and its point",
  },
];
