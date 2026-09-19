/** The parts of a JSON Schema the docs pages show for a parameter. */
export interface Schema {
  type?: string;
  enum?: string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  description?: string;
}

/** −90, or 10 000 000: a real minus, and thousands grouped with a narrow space, which reads in both languages. */
const bound = (n: number) => new Intl.NumberFormat("fr-FR", { useGrouping: Math.abs(n) >= 10_000 }).format(n).replace("-", "−");

/**
 * A parameter's type and bounds in interval notation, or the values an enum takes. An enum
 * value keeps its hyphen, since -population is what gets typed.
 */
export function typeOf(s: Schema): string | string[] {
  if (s.enum) return s.enum;
  if (s.type === "array" && s.items) {
    const inner = typeOf(s.items);
    return `(${Array.isArray(inner) ? inner.join(" | ") : inner})[]`;
  }
  const lo = s.minimum !== undefined ? `[${bound(s.minimum)}` : s.exclusiveMinimum !== undefined ? `(${bound(s.exclusiveMinimum)}` : null;
  const range = lo !== null && s.maximum !== undefined ? ` ${lo}, ${bound(s.maximum)}]` : "";
  return `${s.type ?? ""}${range}`;
}
