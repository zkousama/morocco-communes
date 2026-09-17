const LABEL = /^(Commune|Arrondissement|Cercle|Province|Préfecture|Région)\s+(de\s+la\s+|de\s+l['’]|de\s+|du\s+|des\s+|d['’])?/i;

export function slugify(nameFr: string): string {
  return nameFr
    .replace(LABEL, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueSlugs(names: { code: string; nameFr: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const { nameFr } of names) {
    const slug = slugify(nameFr);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const { code, nameFr } of names) {
    const slug = slugify(nameFr);
    out.set(code, counts.get(slug)! > 1 ? `${slug}-${code.replace(/\./g, "")}` : slug);
  }
  return out;
}
