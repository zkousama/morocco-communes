/**
 * Names a place is known by that are not the name the census prints.
 *
 * Trigram overlap already finds transliteration variants: `Shefshaouen` reaches
 * Chefchaouen, `Ayt Qamra` reaches Ait Kamra, `Tetuan` reaches Tétouan. What it cannot
 * reach is a name built from different letters altogether — `Fez` shares no useful trigram
 * with `Fès`, and `Mogador` shares none with `Essaouira`. Those are exonyms and historical
 * names, and the only thing that finds them is a list.
 *
 * The list is deliberately short. Each entry is a name in documented use, either an
 * established exonym in another language or the name a place was administered under
 * before 1956, and each points at a code checked against the dataset when the index is
 * built. Guessing at plausible-looking variants would put invented names in an API whose
 * whole argument is that its contents are sourced.
 */
export interface Exonym {
  /** The alternate name, in any script; it is normalised before use. */
  name: string;
  /** The canonical commune code, verified at build time. */
  code: string;
  /** Where the name comes from, so the entry can be judged rather than trusted. */
  origin: string;
}

export const EXONYMS: Exonym[] = [
  { name: "Fez", code: "03.231.01.0", origin: "English and French exonym for Fès" },
  { name: "Alhucemas", code: "01.051.01.01", origin: "Spanish name for Al Hoceima" },
  { name: "Mogador", code: "07.211.01.05", origin: "European name for Essaouira until 1956" },
  { name: "Mazagan", code: "06.181.01.03", origin: "Portuguese name for El Jadida" },
  { name: "Mazagão", code: "06.181.01.03", origin: "Portuguese name for El Jadida" },
  { name: "Alcazarquivir", code: "01.331.01.01", origin: "Spanish name for Ksar El Kebir" },
  { name: "Xauen", code: "01.151.01.01", origin: "Spanish name for Chefchaouen" },
  { name: "El Aaiun", code: "11.321.01.03", origin: "Spanish name for Laâyoune" },
  { name: "Aaiun", code: "11.321.01.03", origin: "Spanish name for Laâyoune" },
  { name: "Villa Cisneros", code: "12.391.01.01", origin: "Spanish name for Dakhla until 1975" },
  { name: "Dar el Beida", code: "06.141.01.0", origin: "Casablanca's Arabic name in Latin script" },
  { name: "Tanja", code: "01.511.01.0", origin: "Tanger's Arabic name in Latin script" },
  { name: "Fedala", code: "06.371.01.01", origin: "name of Mohammadia until 1960" },
  { name: "Port Lyautey", code: "04.281.01.01", origin: "name of Kénitra until 1956" },
  { name: "Petitjean", code: "04.481.01.11", origin: "name of Sidi Kacem until 1956" },
  { name: "Mequinez", code: "03.061.01.01", origin: "Spanish name for Meknès" },
  { name: "Arzila", code: "01.511.01.01", origin: "Spanish and Portuguese name for Assilah" },
  { name: "Arcila", code: "01.511.01.01", origin: "Spanish name for Assilah" },
];
