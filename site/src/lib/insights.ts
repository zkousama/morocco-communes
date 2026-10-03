/**
 * The standout figures the insights pipeline published, read once at build time for the
 * commune pages, and the words for the context beside each. Nothing is published on a
 * fresh checkout, so the map starts empty; only a missing directory reads that way, and a
 * file that doesn't parse fails the build, as it does for the API.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FALL, SWING } from "../../../api/src/lib/mismatch.ts";
import {
  ARTEFACT_POPULATION_CHANGE_CEILING,
  CHANGE_GAP_POPULATION_FLOOR,
  CHANGE_MIN_LEVEL_SIZE,
  DEFAULT_CAP,
  DEFAULT_PER_UNIT,
  EXTREME_POPULATION_FLOOR,
  EXTREME_TAIL_SHARE,
  GAP_MIN_GROUP_SIZE,
  MAX_HOUSEHOLD_SIZE,
  MAX_PEOPLE_PER_ROOM,
  Z_THRESHOLD,
} from "../../../insights/src/detect.ts";
import { SAMPLE_HOUSEHOLDS, SMALL_BASE } from "../../../insights/src/filter.ts";
import { MAX_PER_HOUSEHOLD, MIN_HOUSEHOLDS } from "../../../api/src/lib/ordinary.ts";
import { field } from "../../../insights/src/fields.ts";
import type { CommuneFile, Published } from "../../../insights/src/run.ts";
import { figure as withUnit } from "../../../insights/src/text.ts";
import { fill, places } from "../i18n/places";
import type { Locale } from "../i18n/ui";
import { moroccoLine } from "./context";
import { numbers, percent, signedIn } from "./format";
import { figure as censusFigure, indicatorsOf } from "./indicators";
import { communeOf, communes } from "./places";
import { nameIn } from "./names";

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Every commune file under `dir`, by the commune's code. Empty when nothing has been published. */
export function readInsights(dir: string): Map<string, CommuneFile> {
  let names: string[];
  try {
    names = readdirSync(join(dir, "communes"));
  } catch (error) {
    if (isMissing(error)) return new Map();
    throw error;
  }
  const files = names.filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(dir, "communes", n), "utf8")) as CommuneFile);
  return new Map(files.map((f) => [f.code, f]));
}

export const insightsOf = readInsights("data/v1/insights");

export interface StandoutRow {
  code: string;
  name: string;
  route: string;
  topic: string;
  score: number;
  line: Published["line"];
  finding: Published;
}

export interface StandoutGroup {
  topic: string;
  rows: StandoutRow[];
}

/**
 * Topics a reader is most likely to care about, in that order. The two language topics
 * sit together. Anything else follows, still with the highest finding first.
 */
const LEADING_TOPICS = [
  "age",
  "localLanguages",
  "languagesReadAndWritten",
  "employmentStatus",
  "commute",
  "economy",
  "amenities",
  "housing",
];

const topicRank = (topic: string) => {
  const rank = LEADING_TOPICS.indexOf(topic);
  return rank === -1 ? LEADING_TOPICS.length : rank;
};

/**
 * The insights page's list. One finding per commune, its highest, then the 40 highest of
 * those, so one place can't fill the page. A commune with no page is left out: the list
 * would otherwise link nowhere. Groups follow the topic before the dot in the measure.
 */
export function standouts(
  files: Iterable<CommuneFile>,
  pageFor: (code: string) => { route: string } | null,
  limit = 40,
): StandoutGroup[] {
  const chosen: StandoutRow[] = [];
  for (const file of files) {
    const page = pageFor(file.code);
    if (!page || file.findings.length === 0) continue;
    let best = file.findings[0]!;
    for (const finding of file.findings) if (finding.score > best.score) best = finding;
    chosen.push({
      code: file.code,
      name: file.name.fr,
      route: page.route,
      topic: best.measure.split(".")[0] || best.measure,
      score: best.score,
      line: best.line,
      finding: best,
    });
  }
  chosen.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  const groups: StandoutGroup[] = [];
  const byTopic = new Map<string, StandoutGroup>();
  for (const row of chosen.slice(0, limit)) {
    let group = byTopic.get(row.topic);
    if (!group) {
      group = { topic: row.topic, rows: [] };
      byTopic.set(row.topic, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups.sort((a, b) => topicRank(a.topic) - topicRank(b.topic));
}

/** Fewer communes than this and a rank among peers isn't worth a line. */
export const PEER_MIN = 20;
export const PEER_SMALL = 5000;
export const PEER_MID = 20000;
export const PEER_TAILS = [1, 5, 10] as const;

/** The pipeline's own settings, for the methods page to state rather than retype: shares as fractions, the rest as counts. */
export const method = {
  extremeFloor: EXTREME_POPULATION_FLOOR,
  extremeTail: EXTREME_TAIL_SHARE,
  deviations: Z_THRESHOLD,
  changeLevelSize: CHANGE_MIN_LEVEL_SIZE,
  gapGroupSize: GAP_MIN_GROUP_SIZE,
  artefactCeiling: ARTEFACT_POPULATION_CHANGE_CEILING,
  changeGapFloor: CHANGE_GAP_POPULATION_FLOOR,
  peoplePerRoom: MAX_PEOPLE_PER_ROOM,
  householdSize: MAX_HOUSEHOLD_SIZE,
  kept: DEFAULT_CAP,
  perPlace: DEFAULT_PER_UNIT,
  swing: SWING,
  fall: FALL,
  neighbourFloor: CHANGE_GAP_POPULATION_FLOOR,
  smallBase: SMALL_BASE,
  minHouseholds: MIN_HOUSEHOLDS,
  maxPerHousehold: MAX_PER_HOUSEHOLD,
  sampleHouseholds: SAMPLE_HOUSEHOLDS,
  peerGroup: PEER_MIN,
  peerSmall: PEER_SMALL,
  peerMid: PEER_MID,
  peerTop: PEER_TAILS[0],
  peerHigh: PEER_TAILS[1],
  peerWide: PEER_TAILS[2],
};

const isShare = (path: string) => field(path)?.unit === "percent";

/** A change as a signed amount: points for a share, the figure's own unit otherwise. */
function signed(locale: Locale, path: string, change: number): string {
  const sign = change < 0 ? "−" : change > 0 ? "+" : "";
  if (!isShare(path)) return signedIn(locale, `${sign}${withUnit(path, Math.abs(change), locale)}`);
  const body = numbers(locale, 1, true).format(Math.abs(change));
  // French keeps "point" singular below 2, as it does "enfant"; Arabic counts a decimal in the singular.
  const unit = locale === "ar" ? "نقطة" : locale === "fr" && Math.abs(change) < 2 ? "point" : "points";
  return signedIn(locale, `${sign}${body} ${unit}`);
}

/**
 * The communes it borders on the same figure, in words: their median and the one furthest
 * off, with that one's name kept apart so the page can link it. A change is set against
 * their change. Null when none could be compared.
 */
export function nearLine(locale: Locale, f: Published): { before: string; name: string; code: string; after: string } | null {
  const near = f.context.neighbours;
  if (!near) return null;
  const p = places[locale];
  const amount = (v: number) => (f.kind === "change" ? signed(locale, f.measure, v) : withUnit(f.measure, v, locale));
  const value = amount(near.furthest.value);
  const sentence =
    near.compared === 1
      ? fill(p.insightsNearOne, { value: f.kind === "change" ? fill(p.insightsSince, { value }) : value })
      : fill(near.compared === near.bordering ? p.insightsNearAll : p.insightsNearSome, {
          n: near.compared,
          of: near.bordering,
          median: fill(f.kind === "change" ? p.insightsMedianChange : p.insightsMedian, { value: amount(near.median) }),
          value,
        });
  const [before, after] = sentence.split("{place}") as [string, string];
  return { before, name: nameIn(locale, near.furthest.name), code: near.furthest.code, after };
}

/**
 * The same figure in 2014, then Morocco's move: in whole points for a share, as the since-2014
 * line puts it, and as its 2 figures otherwise. A change's own line already has both of its
 * years, so it gets Morocco's alone. Null where 2014 can't be set beside it.
 */
export function since2014Line(locale: Locale, f: Published): string | null {
  const since = f.context.since2014;
  if (!since) return null;
  const p = places[locale];
  const digits = field(f.measure)?.unit === "births per woman" ? 2 : 1;
  const morocco = isShare(f.measure)
    ? moroccoLine(locale, since.morocco.then, since.morocco.now)
    : fill(p.insightsMoroccoFrom, { then: numbers(locale, digits, true).format(since.morocco.then), now: withUnit(f.measure, since.morocco.now, locale) });
  return f.kind === "change" ? morocco : `${fill(p.insightsThen, { then: withUnit(f.measure, since.then, locale) })} ${morocco}`;
}

const censusValue = (code: string, measure: string): number | null => {
  if (field(measure)?.source !== "census") return null;
  const record = indicatorsOf.get(code);
  if (!record) return null;
  return censusFigure(record.people.total?.all, measure) ?? censusFigure(record.households.total, measure);
};

const sizeBand = (population: number) => (population < PEER_SMALL ? "under" : population <= PEER_MID ? "mid" : "over");

/**
 * The tightest upper tail that still covers this value among its peers. Ties share the
 * best rank. Null when the group is under 20 or the value isn't in the top 10%.
 */
export function peerTailOf(value: number, values: number[]): (typeof PEER_TAILS)[number] | null {
  const n = values.length;
  if (n < PEER_MIN) return null;
  const share = (values.filter((v) => v > value).length + 1) / n;
  for (const tail of PEER_TAILS) if (share <= tail / 100) return tail;
  return null;
}

export interface PeerSpec {
  type: "urban" | "rural";
  population: number;
  measure: string;
  value: number;
  peers: number[];
}

/** The sentence for a census figure that's high among communes of the same type and size. */
export function peerLineOf(locale: Locale, spec: PeerSpec): string | null {
  if (field(spec.measure)?.source !== "census") return null;
  const tail = peerTailOf(spec.value, spec.peers);
  if (tail === null) return null;
  const p = places[locale];
  const n = numbers(locale);
  const kind = spec.type === "urban" ? p.insightsPeerUrban : p.insightsPeerRural;
  const pct = percent(locale, tail, { digits: 0 });
  const band = sizeBand(spec.population);
  if (band === "under") return fill(p.insightsPeerUnder, { kind, n: n.format(PEER_SMALL), p: pct });
  if (band === "mid") return fill(p.insightsPeerMid, { kind, from: n.format(PEER_SMALL), to: n.format(PEER_MID), p: pct });
  return fill(p.insightsPeerOver, { kind, n: n.format(PEER_MID), p: pct });
}

/**
 * How a standout census figure ranks among communes of the same type and size band.
 * Null for an economy or housing figure, a group under 20, or one outside the top 10%.
 */
export function peerLine(locale: Locale, code: string, f: Published): string | null {
  const here = communeOf.get(code);
  const value = censusValue(code, f.measure);
  if (!here || value === null) return null;
  const { type } = here;
  const population = here.population["2024"].total;
  const band = sizeBand(population);
  const peers: number[] = [];
  for (const commune of communes) {
    if (commune.type !== type || sizeBand(commune.population["2024"].total) !== band) continue;
    const v = censusValue(commune.code, f.measure);
    if (v !== null) peers.push(v);
  }
  return peerLineOf(locale, { type, population, measure: f.measure, value, peers });
}

/** One line of a standout's plot: a single value, or where it was in 2014 and is now. */
export interface PlotRow {
  key: "here" | "neighbours" | "province" | "morocco" | "average";
  from?: number;
  value: number;
}

export interface StandoutPlot {
  unit: string;
  top: number;
  rows: PlotRow[];
}

const ROUND = [1, 2, 2.5, 5];

/** The top of a plot's scale: the first round number past every value on it, and 100 for a share at most. */
export function scaleTop(values: number[], unit: string): number {
  const most = Math.max(0, ...values) * 1.08;
  if (most === 0) return 1;
  let power = 10 ** Math.floor(Math.log10(most));
  for (;;) {
    for (const step of ROUND) {
      const top = step * power;
      if (top >= most) return unit === "percent" ? Math.min(top, 100) : top;
    }
    power *= 10;
  }
}

/**
 * What a standout's plot sets side by side, on one scale from 0. A change shows the commune
 * and Morocco from 2014 to 2024. A figure set against its province shows the province, and one
 * at the edge of Morocco's communes shows Morocco where the 2014 census asked it the same way,
 * and the average commune where it didn't. The communes it borders show where any were
 * compared, except on a change, whose neighbour median is a change and not a level.
 */
export function standoutPlot(f: Published): StandoutPlot {
  const unit = field(f.measure)?.unit ?? "";
  const since = f.context.since2014;
  const rows: PlotRow[] = [];
  if (f.kind === "change") {
    if (since) {
      rows.push({ key: "here", from: since.then, value: since.now });
      if (since.morocco) rows.push({ key: "morocco", from: since.morocco.then, value: since.morocco.now });
    }
  } else {
    rows.push({ key: "here", value: f.value });
    if (f.context.neighbours?.median != null) rows.push({ key: "neighbours", value: f.context.neighbours.median });
    if (f.kind === "gap") rows.push({ key: "province", value: f.reference });
    else if (since?.morocco) rows.push({ key: "morocco", value: since.morocco.now });
    else rows.push({ key: "average", value: f.reference });
  }
  return { unit, top: scaleTop(rows.flatMap((r) => [r.value, r.from ?? 0]), unit), rows };
}
