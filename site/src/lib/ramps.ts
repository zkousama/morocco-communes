/**
 * The home map's extra ramps. Each one uses the green ramp's lightness steps, so a
 * swatch keeps its contrast when the hue changes. Water is blue, age is purple,
 * unemployment is orange. Women's illiteracy stays on the green ramp.
 *
 * Blue and orange stay apart under protanopia. Purple and blue do not, and no
 * view shows both.
 */

export const PAPER = { light: "#f1efe9", dark: "#191b16" } as const;

export const RAMPS = {
  light: {
    water: ["#88a8c9", "#6e95be", "#5381b0", "#3e6e9d", "#2c5986", "#21466a"],
    elder: ["#ad9cc3", "#9c86b6", "#896fa7", "#775c95", "#62497e", "#4d3963"],
    unemp: ["#bf9d7d", "#b1885f", "#a17241", "#8e5e2b", "#784b18", "#5e3a11"],
  },
  dark: {
    water: ["#385878", "#476f99", "#5587ba", "#6aa0d7", "#82b9f2", "#a8d2fe"],
    elder: ["#5e4c73", "#776092", "#9074b1", "#a98bcd", "#c3a4e8", "#dbbffd"],
    unemp: ["#6e4e2c", "#8c6237", "#aa7642", "#c68e56", "#e1a76e", "#f7c28f"],
  },
} as const;

const byte = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const lum = (hex: string) => 0.2126 * linear(byte(hex, 0)) + 0.7152 * linear(byte(hex, 1)) + 0.0722 * linear(byte(hex, 2));

/** WCAG contrast of two colours. */
export function contrast(a: string, b: string): number {
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}

const oklab = (hex: string): [number, number, number] => {
  const r = linear(byte(hex, 0));
  const g = linear(byte(hex, 1));
  const b = linear(byte(hex, 2));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/** Distance in OKLab. Neighbours on a ramp need about 0.05 to stay apart. */
export function deltaE(a: string, b: string): number {
  const [L1, a1, b1] = oklab(a);
  const [L2, a2, b2] = oklab(b);
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2);
}

/**
 * Protanopia, the Machado matrix at full severity, so a check can see whether two
 * hues collapse. Linear RGB in, linear RGB out.
 */
const protan = (hex: string): [number, number, number] => {
  const r = linear(byte(hex, 0));
  const g = linear(byte(hex, 1));
  const b = linear(byte(hex, 2));
  return [
    0.152286 * r + 1.052583 * g - 0.204868 * b,
    0.114503 * r + 0.786281 * g + 0.099216 * b,
    -0.003882 * r - 0.048116 * g + 1.051998 * b,
  ];
};

const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

/** The colour as a protanope sees it, clipped into sRGB. */
export function protanopia(hex: string): string {
  const [r, g, b] = protan(hex);
  const h = (n: number) => fromLinear(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Every step clears the page at 2:1, the same bar as the palest green. Neighbours
 * stay apart, and the strongest step clears 3:1.
 */
export function rampReadable(steps: readonly string[], paper: string): boolean {
  if (steps.length !== 6) return false;
  if (steps.some((step) => contrast(step, paper) < 2)) return false;
  if (Math.max(...steps.map((step) => contrast(step, paper))) < 3) return false;
  for (let i = 1; i < steps.length; i++) if (deltaE(steps[i - 1]!, steps[i]!) < 0.05) return false;
  return true;
}
