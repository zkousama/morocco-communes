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
}

/** One row of the list: a link, the name, the quiet line and the Arabic. */
export interface Row {
  href: string;
  name: string;
  meta: string;
  ar: string;
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
}

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

export const rowOf = (hit: Hit, places: Places, levels: Record<string, string>): Row | null => {
  const href = hrefOf(hit, places);
  return href === null ? null : { href, name: hit.name.fr, meta: metaOf(hit, places, levels), ar: hit.name.ar };
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
  `<span class="hit-ar" lang="ar" dir="rtl">${escape(row.ar)}</span></a>`;
