/**
 * A radial chart of how a commune and its twin rank among communes of 5,000 people
 * or more. Each spoke is a percentile, 0 to 100. Morocco's middle is the rank 50
 * ring, the same on every spoke, not a national average.
 */
import { mismatches } from "../../../api/src/lib/mismatch.ts";
import { twinOf } from "./context.ts";
import { figure, indicatorsOf } from "./indicators.ts";
import { communes } from "./places.ts";

/** Fewer people than this and a share moves too much to rank. The same floor as a twin. */
export const WHEEL_FLOOR = 5000;
export const WHEEL_WIDTH = 400;
export const WHEEL_HEIGHT = 300;
/** Rank 100 sits this far from the centre, in the chart's own units, leaving the rest for labels. */
export const WHEEL_PLOT = 100;

export const WHEEL_SPOKES = [
  "literacy",
  "education.higher",
  "employment",
  "amenities.runningWater",
  "dwellingType.apartment",
  "households.averageSize",
  "age.0-14",
  "age.65+",
] as const;

export type WheelSpoke = (typeof WHEEL_SPOKES)[number];

export interface WheelProfile {
  twin: string;
  ranks: { here: number[]; twin: number[] };
  values: { here: number[]; twin: number[] };
}

export interface LabelBox {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  lines: string[];
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where `value` sits in `values`, from 0 at the lowest to 100 at the highest.
 * A tie takes the middle of the span it shares. One value has nothing to rank against.
 */
export function percentileRank(value: number, values: number[]): number {
  const n = values.length;
  if (n < 2) return 50;
  const below = values.filter((v) => v < value).length;
  const equal = values.filter((v) => v === value).length;
  return ((below + (equal - 1) / 2) / (n - 1)) * 100;
}

const CX = WHEEL_WIDTH / 2;
const CY = WHEEL_HEIGHT / 2;
// Instrument Sans at 12px, taken wide so a label that clears this box still fits on the page.
const CHAR = 7;
const LINE = 14;

const spokeAngle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / WHEEL_SPOKES.length;

const clearance = (box: LabelBox) => {
  const dx = CX < box.left ? box.left - CX : CX > box.right ? CX - box.right : 0;
  const dy = CY < box.top ? box.top - CY : CY > box.bottom ? CY - box.bottom : 0;
  return Math.hypot(dx, dy);
};

/** Where each spoke's label sits. The box stays inside the chart and outside the polygon. */
export function labelBoxes(labels: string[][]): LabelBox[] {
  return labels.map((lines, i) => {
    const angle = spokeAngle(i);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const width = Math.max(...lines.map((line) => line.length), 1) * CHAR;
    const height = lines.length * LINE;
    const anchor: LabelBox["anchor"] = Math.abs(cos) < 0.4 ? "middle" : cos > 0 ? "start" : "end";
    const at = (r: number): LabelBox => {
      const x = CX + cos * r;
      const y = CY + sin * r;
      const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
      const top = y - height / 2;
      return { x, y: y - ((lines.length - 1) * LINE) / 2, anchor, lines, left, top, right: left + width, bottom: top + height };
    };
    let radius = WHEEL_PLOT + 10;
    let box = at(radius);
    for (let step = 0; step < 48 && clearance(box) < WHEEL_PLOT + 2; step++) {
      radius += 1;
      box = at(radius);
    }
    return box;
  });
}

const round = (n: number) => Math.round(n * 10) / 10;

const point = (rank: number, i: number) => {
  const angle = spokeAngle(i);
  const r = (rank / 100) * WHEEL_PLOT;
  return `${round(CX + r * Math.cos(angle))},${round(CY + r * Math.sin(angle))}`;
};

const escapeXml = (text: string) => text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The chart: the commune solid, the twin dashed, Morocco's middle a dashed grey ring. */
export function wheelSvg(labels: string[][], here: number[], twin: number[], caption: string): string {
  const rings = [
    `<polygon points="${Array.from({ length: 8 }, (_, i) => point(50, i)).join(" ")}" fill="none" stroke="var(--quiet)" stroke-width="1.25" stroke-dasharray="2 3"/>`,
    `<polygon points="${twin.map((rank, i) => point(rank, i)).join(" ")}" fill="none" stroke="var(--chart-down)" stroke-width="1.75" stroke-dasharray="5 3"/>`,
    `<polygon points="${here.map((rank, i) => point(rank, i)).join(" ")}" fill="var(--chart-up)" fill-opacity="0.18" stroke="var(--chart-up)" stroke-width="1.75"/>`,
  ];
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const edge = point(100, i).split(",");
    return `<line x1="${CX}" y1="${CY}" x2="${edge[0]}" y2="${edge[1]}" stroke="var(--quiet)" stroke-opacity="0.35"/>`;
  });
  const texts = labelBoxes(labels).map((box) => {
    const lines = box.lines
      .map((line, k) => `<tspan x="${round(box.x)}" dy="${k === 0 ? 0 : LINE}">${escapeXml(line)}</tspan>`)
      .join("");
    return `<text x="${round(box.x)}" y="${round(box.y)}" text-anchor="${box.anchor}" dominant-baseline="central" font-size="12">${lines}</text>`;
  });
  return `<svg viewBox="0 0 ${WHEEL_WIDTH} ${WHEEL_HEIGHT}" role="img" aria-label="${escapeXml(caption)}">${spokes.join("")}${rings.join("")}${texts.join("")}</svg>`;
}

const ages = (topics: Parameters<typeof figure>[0], bands: string[]): number | null => {
  let total = 0;
  for (const band of bands) {
    const v = figure(topics, `age.${band}`);
    if (v === null) return null;
    total += v;
  }
  return Math.round(total * 10) / 10;
};

interface Reading {
  code: string;
  population: number;
  values: (number | null)[];
}

const readings: Reading[] = communes.flatMap((commune) => {
  const record = indicatorsOf.get(commune.code);
  if (!record) return [];
  const people = record.people.total?.all;
  const homes = record.households.total;
  const illiteracy = figure(people, "illiteracy.rate10Plus");
  const unemployment = figure(people, "labour.unemploymentRate");
  const waterFlagged = mismatches(record, record["2014"]).some((m) => m.path === "amenities.runningWater");
  return [
    {
      code: commune.code,
      population: commune.population["2024"].total,
      values: [
        illiteracy === null ? null : Math.round((100 - illiteracy) * 10) / 10,
        figure(people, "education.higher"),
        unemployment === null ? null : Math.round((100 - unemployment) * 10) / 10,
        waterFlagged ? null : figure(homes, "amenities.runningWater"),
        figure(homes, "dwellingType.apartment"),
        figure(homes, "households.averageSize"),
        ages(people, ["0-4", "5-9", "10-14"]),
        ages(people, ["65-69", "70-74", "75+"]),
      ],
    },
  ];
});

const byCode = new Map(readings.map((reading) => [reading.code, reading]));
const pools = WHEEL_SPOKES.map((_, i) =>
  readings.flatMap((reading) => {
    const value = reading.values[i];
    return reading.population >= WHEEL_FLOOR && value !== null ? [value] : [];
  }),
);

/** The commune's wheel, or null when it has no twin or a spoke is missing. */
export function wheelOf(code: string): WheelProfile | null {
  const twin = twinOf(code);
  const here = byCode.get(code);
  const there = twin && byCode.get(twin.code);
  if (!twin || !here || !there) return null;
  if (here.values.some((v) => v === null) || there.values.some((v) => v === null)) return null;
  const rank = (values: (number | null)[]) => values.map((value, i) => percentileRank(value!, pools[i]!));
  return {
    twin: twin.code,
    ranks: { here: rank(here.values), twin: rank(there.values) },
    values: { here: here.values as number[], twin: there.values as number[] },
  };
}
