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
import { field } from "../../../insights/src/fields.ts";
import type { CommuneFile, Published } from "../../../insights/src/run.ts";
import { figure as withUnit } from "../../../insights/src/text.ts";
import { fill, places } from "../i18n/places";
import type { Locale } from "../i18n/ui";
import { moroccoLine } from "./context";
import { numbers } from "./format";

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
 * The insights page's list. One finding per commune, its highest, then the 60 highest of
 * those, so one place can't fill the page. A commune with no page is left out: the list
 * would otherwise link nowhere. Groups follow the topic before the dot in the measure,
 * and the group with the highest finding comes first.
 */
export function standouts(
  files: Iterable<CommuneFile>,
  pageFor: (code: string) => { route: string } | null,
  limit = 60,
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
  return groups;
}

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
};

const isShare = (path: string) => field(path)?.unit === "percent";

/** A change as a signed amount: points for a share, the figure's own unit otherwise. */
function signed(locale: Locale, path: string, change: number): string {
  const sign = change < 0 ? "−" : change > 0 ? "+" : "";
  if (!isShare(path)) return `${sign}${withUnit(path, Math.abs(change), locale)}`;
  const body = numbers(locale, 1, true).format(Math.abs(change));
  // French keeps "point" singular below 2, as it does "enfant".
  const unit = locale === "fr" && Math.abs(change) < 2 ? "point" : "points";
  return `${sign}${body} ${unit}`;
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
  return { before, name: near.furthest.name.fr, code: near.furthest.code, after };
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
