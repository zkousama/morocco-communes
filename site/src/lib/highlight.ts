/**
 * JSON as HTML, with keys, strings, numbers and literals marked for colour. Done at build
 * time from the value itself rather than by re-tokenising text, so it can't mis-colour a
 * string that happens to contain a colon or a quote.
 */
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function highlightJson(value: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (value === null || typeof value === "boolean") return `<span class="j-l">${value}</span>`;
  if (typeof value === "number") return `<span class="j-n">${value}</span>`;
  if (typeof value === "string") return `<span class="j-s">${escape(JSON.stringify(value))}</span>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Short arrays of numbers, like a bbox, read better on one line.
    if (value.length <= 4 && value.every((v) => typeof v === "number")) {
      return `[${value.map((v) => highlightJson(v)).join(", ")}]`;
    }
    return `[\n${value.map((v) => inner + highlightJson(v, depth + 1)).join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const lines = entries.map(
    ([k, v]) => `${inner}<span class="j-k">${escape(JSON.stringify(k))}</span>: ${highlightJson(v, depth + 1)}`,
  );
  return `{\n${lines.join(",\n")}\n${pad}}`;
}

export { escape as escapeHtml };
