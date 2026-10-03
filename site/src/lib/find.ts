/**
 * What the search in the header shows for a place, worked out the same way for a search
 * result in the browser and for a most looked-up place at build time: where its page is,
 * and the quiet line under its name that says what it is and where it sits.
 */

/** A place as `/api/search` returns it. */
export interface Hit {
  code: string;
  level: string;
  name: { fr: string; ar: string };
  slug: string;
  /** The neighbourhood a search named, when it found this unit through one. */
  neighbourhood?: { fr: string; ar: string };
  /** The postcode a search was, when it found this commune by it. */
  postcode?: { code: string; neighbourhoods: string[] };
  /** How the search found it: by code, name or spelling, or only by letters in common ("trigram"). */
  matched?: string;
}

/**
 * One row of the list: a link, the name, the quiet line and the name in the other script.
 * That's the Arabic beside a Latin name, and on the Arabic site the Latin beside an Arabic
 * one, which `latin` says.
 */
export interface Row {
  href: string;
  name: string;
  meta: string;
  ar: string;
  latin?: true;
}

/** The little the browser needs to know about the dataset to place a hit. */
export interface Places {
  /** Where each level's pages live, in the page's language. */
  base: { commune: string; province: string; region: string };
  /** A région's code to its name. */
  regions: Record<string, string>;
  /** The cities that hold arrondissements, by code, since an arrondissement's page is its city's. */
  cities: Record<string, { slug: string; name: string }>;
  /** Provinces that are préfectures, which the API names "province" like the rest. */
  prefectures: string[];
  /** A commune's code to its province, for the communes whose name another one shares. */
  shared: Record<string, string>;
  /** True on the Arabic site, where a row leads with the Arabic name and sets the Latin one beside it. */
  arabic?: boolean;
}

/** A name's 2 spellings in the order the page's language leads with, the second empty where there's only one. */
const lead = (places: Places, latin: string, arabic: string): Pick<Row, "name" | "ar" | "latin"> =>
  places.arabic && arabic ? { name: arabic, ar: latin, latin: true } : { name: latin || arabic, ar: latin ? arabic : "" };

/** The comma a list in the quiet line is joined with. */
const comma = (places: Places) => (places.arabic ? "، " : ", ");

/** The city an arrondissement belongs to: 01.511.01.05 is in 01.511.01.0, Tanger. */
export const cityCode = (code: string) => `${code.split(".").slice(0, 3).join(".")}.0`;

/** Where a hit's page is. A cercle has none, and nor does an arrondissement of no known city. */
export const hrefOf = (hit: Hit, places: Places): string | null => {
  if (hit.level === "commune") return `${places.base.commune}${hit.slug}/`;
  if (hit.level === "province") return `${places.base.province}${hit.slug}/`;
  if (hit.level === "region") return `${places.base.region}${hit.slug}/`;
  if (hit.level === "arrondissement") {
    const city = places.cities[cityCode(hit.code)];
    return city ? `${places.base.commune}${city.slug}/` : null;
  }
  return null;
};

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The level and where it sits: "Commune · Casablanca-Settat". A commune whose name another
 * commune shares names its province instead, so the 2 rows read apart, and an
 * arrondissement names its city. A région's line is its level alone.
 */
export const metaOf = (hit: Hit, places: Places, levels: Record<string, string>): string => {
  const level =
    hit.level === "province" && places.prefectures.includes(hit.code) ? "prefecture" : hit.level;
  const label = capital(levels[level] ?? level);
  const region = places.regions[hit.code.split(".")[0] ?? ""];
  const where =
    hit.level === "arrondissement"
      ? places.cities[cityCode(hit.code)]?.name
      : hit.level === "region"
        ? undefined
        : hit.level === "commune"
          ? (places.shared[hit.code] ?? region)
          : region;
  return where ? `${label} · ${where}` : label;
};

/** A douar the douar search found, as the API's /api/douars/search gives it. */
export interface DouarHit {
  code: string;
  name: { ar: string; latin: string };
  commune: { slug: string; name: string; ar?: string };
}

/** A douar's row: its name, "Douar · its commune", its name in the other script, and a link to its row on the commune's page. */
export const douarRowOf = (hit: DouarHit, places: Places, levels: Record<string, string>): Row => ({
  href: `${places.base.commune}${hit.commune.slug}/#douar-${hit.code}`,
  ...lead(places, hit.name.latin, hit.name.ar),
  meta: `${capital(levels.douar ?? "douar")} · ${(places.arabic && hit.commune.ar) || hit.commune.name}`,
});

export const rowOf = (hit: Hit, places: Places, levels: Record<string, string>): Row | null => {
  const href = hrefOf(hit, places);
  if (href === null) return null;
  if (hit.postcode) {
    // The postcode is what was typed; the commune, and the start of the neighbourhoods it covers, say where it is.
    const own = lead(places, hit.name.fr, hit.name.ar);
    const where = [own.name, ...hit.postcode.neighbourhoods].join(comma(places));
    return { ...own, href, name: hit.postcode.code, meta: `${capital(levels.postcode ?? "postcode")} · ${where}` };
  }
  const hood = hit.neighbourhood;
  if (!hood) return { href, ...lead(places, hit.name.fr, hit.name.ar), meta: metaOf(hit, places, levels) };
  // The neighbourhood is the name the reader typed, and the unit holding it goes on the quiet line.
  const city = hit.level === "arrondissement" ? places.cities[cityCode(hit.code)]?.name : undefined;
  const label = capital(levels.neighbourhood ?? "neighbourhood");
  const unit = lead(places, hit.name.fr, hit.name.ar).name;
  return {
    href,
    ...lead(places, hood.fr, hood.ar),
    meta: `${label} · ${city ? `${unit}${comma(places)}${city}` : unit}`,
  };
};

const arabic = "\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC";
// Words joined by spaces or hyphens are one run, so a two-word name keeps its own order.
// An isolate already in the text is matched whole, and handed back as it was.
const run = new RegExp(`\\u2068[^\\u2069]*\\u2069|[${arabic}]+(?:[\\s-]+[${arabic}]+)*`, "g");

/**
 * Wraps each run of Arabic in a first-strong isolate, U+2068 to U+2069, so a left-to-right
 * line that quotes it keeps its own order: without one, "طنجة, 01.511.01.0" draws the
 * code on the wrong side of the name. A run already isolated is left as it is.
 */
export const isolate = (text: string) =>
  text.replace(run, (match) => (match.startsWith("\u2068") ? match : `\u2068${match}\u2069`));

export const escape = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * A row as the list draws it, an option of the list box the field controls. The spaces
 * between its parts draw nothing in the row's flex box, and keep the words apart when a
 * screen reader reads the option out as one name.
 */
export const rowHtml = (row: Row, id: string) =>
  `<a class="hit" role="option" tabindex="-1" aria-selected="false" id="${escape(id)}" href="${escape(row.href)}">` +
  `<span class="hit-text"><span class="hit-name">${escape(row.name)}</span> ` +
  `<span class="hit-meta">${escape(row.meta).replace(" · ", ' <span class="hit-sep">·</span> ')}</span></span> ` +
  `<span class="hit-ar" ${row.latin ? 'lang="fr" dir="ltr"' : 'lang="ar" dir="rtl"'}>${escape(row.ar)}</span></a>`;
