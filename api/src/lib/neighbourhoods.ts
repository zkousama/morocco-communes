/**
 * Neighbourhoods, for the search. HCP counts no unit smaller than an arrondissement or a
 * commune, so Sidi Maârouf has no figures of its own: it's in Aïn-Chock, in Casablanca.
 * OpenStreetMap names Morocco's suburbs, quarters and neighbourhoods, and each
 * is placed in the arrondissement or commune whose boundary holds it, so a search for one
 * finds the unit it's in. The names come from OpenStreetMap as tagged; nothing is invented.
 */

const ARABIC = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const TIFINAGH = "\\u2D30-\\u2D7F";
const arabicRun = new RegExp(`[${ARABIC}]+(?:[\\s-]+[${ARABIC}]+)*`, "g");
const notLatin = new RegExp(`[${ARABIC}${TIFINAGH}]+`, "g");

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,;|/-]+|[\s,;|/-]+$/g, "").trim();

/**
 * The French and Arabic names, from `name:fr` and `name:ar` where they're tagged and
 * otherwise from `name`, which often runs Latin, Tifinagh and Arabic together. Null when
 * there's neither.
 */
export function namesOf(tags: Record<string, string>): { fr: string; ar: string } | null {
  const name = tags.name ?? "";
  const latin = tidy(name.replace(notLatin, " "));
  const fr = tags["name:fr"]?.trim() || (/[A-Za-z]/.test(latin) ? latin : "") || tags["name:en"]?.trim() || "";
  const runs = name.match(arabicRun) ?? [];
  const ar = tags["name:ar"]?.trim() || runs.sort((a, b) => b.length - a.length)[0] || "";
  return fr || ar ? { fr, ar } : null;
}

/** Whether a point is inside a polygon, outer ring first and holes after, by the even-odd rule. */
export function inside([x, y]: [number, number], rings: [number, number][][]): boolean {
  let within = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
    }
  }
  return within;
}

/** A neighbourhood as the search index holds it: French name, Arabic name, and the code of the unit it's in. */
export type Neighbourhood = [fr: string, ar: string, code: string];
