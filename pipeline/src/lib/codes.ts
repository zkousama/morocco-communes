/** Strip punctuation and left-pad to the nine-digit join key. */
export function toDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) throw new Error(`no digits in code: ${JSON.stringify(raw)}`);
  if (digits.length > 9) throw new Error(`code longer than nine digits: ${raw}`);
  return digits.padStart(9, "0");
}

/**
 * Canonical dotted form, composed from the row's own raw code and its parent
 * province's raw code. The tail keeps whatever width HCP published, which is how
 * the six arrondissement-bearing cities keep their single-digit final group.
 */
export function toDotted(raw: string, parentProvinceRaw: string): string {
  const own = raw.replace(/\D/g, "");
  const parent = parentProvinceRaw.replace(/\D/g, "");
  if (!own.startsWith(parent)) {
    throw new Error(`code ${raw} does not sit under province ${parentProvinceRaw}`);
  }
  const province = parent.padStart(5, "0");
  const region = province.slice(0, 2);
  const provinceLocal = province.slice(2);
  const rest = own.slice(parent.length);
  if (rest.length === 0) return `${region}.${provinceLocal}`;
  const head = rest.slice(0, 2);
  const tail = rest.slice(2);
  return tail.length === 0
    ? `${region}.${provinceLocal}.${head}`
    : `${region}.${provinceLocal}.${head}.${tail}`;
}

/** A région's code is its own two digits. */
export function formatRegion(raw: string): string {
  return raw.replace(/\D/g, "").padStart(2, "0");
}

/** A province's code is five digits, grouped as region.province. */
export function formatProvince(raw: string): string {
  const digits = raw.replace(/\D/g, "").padStart(5, "0");
  return `${digits.slice(0, 2)}.${digits.slice(2)}`;
}

export function regionOf(digits: string): string {
  return digits.slice(0, 2);
}

export function provinceOf(digits: string): string {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}`;
}
