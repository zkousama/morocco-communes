/**
 * A joint-sequence model for spelling a word from one script in the other, the kind
 * pronunciation dictionaries are built with (Bisani and Ney, 2008), small enough to train
 * here in seconds on the name pairs we hold. No network and no service.
 *
 * Training aligns each pair of words into graphones, a few letters of the source with the
 * letters they're written as: تي with "ti", ة with "a", nothing with an "e" Arabic leaves
 * unwritten. Expectation-maximisation finds the alignments, and an n-gram over graphones,
 * smoothed the Witten-Bell way, learns which follow which. Spelling a word is then a beam
 * search for the likeliest graphones that read the source, which also gives the runners-up.
 */

/** A graphone: source letters, and what they're written as. */
export type Graphone = [source: string, target: string];

export interface Model {
  order: number;
  graphones: Graphone[];
  /** For each n-gram, by its graphone ids joined with spaces, how often it was seen. -1 is the edge of a word. */
  counts: Record<string, number>;
  /** For each history, how many different graphones were seen after it. */
  followers: Record<string, number>;
}

const MAX_SOURCE = 2;
const MAX_TARGET = 3;
const EDGE = -1;

/** Every way a pair of strings splits into graphones, as (i, j, a, b): source i-a..i with target j-b..j. */
function* steps(source: string, target: string) {
  for (let i = 0; i <= source.length; i++) {
    for (let j = 0; j <= target.length; j++) {
      for (let a = 0; a <= Math.min(MAX_SOURCE, i); a++) {
        for (let b = 0; b <= Math.min(MAX_TARGET, j); b++) {
          if (a === 0 && b === 0) continue;
          yield [i, j, a, b] as const;
        }
      }
    }
  }
}

/** Aligns the pairs by expectation-maximisation over graphone probabilities, then reads each pair's likeliest alignment. */
export function align(pairs: readonly [string, string][], rounds = 8): Graphone[][] {
  let p = new Map<string, number>();
  const key = (s: string, t: string) => `${s}\u0000${t}`;
  // Every graphone any pair could use, equally likely to start.
  for (const [s, t] of pairs) for (const [i, j, a, b] of steps(s, t)) p.set(key(s.slice(i - a, i), t.slice(j - b, j)), 1);
  for (const k of p.keys()) p.set(k, 1 / p.size);

  for (let round = 0; round < rounds; round++) {
    const expected = new Map<string, number>();
    for (const [s, t] of pairs) {
      const n = s.length;
      const m = t.length;
      const forward = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
      const backward = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
      forward[0]![0] = 1;
      for (const [i, j, a, b] of steps(s, t)) {
        forward[i]![j]! += forward[i - a]![j - b]! * (p.get(key(s.slice(i - a, i), t.slice(j - b, j))) ?? 0);
      }
      backward[n]![m] = 1;
      for (let i = n; i >= 0; i--) {
        for (let j = m; j >= 0; j--) {
          for (let a = 0; a <= Math.min(MAX_SOURCE, n - i); a++) {
            for (let b = 0; b <= Math.min(MAX_TARGET, m - j); b++) {
              if (a === 0 && b === 0) continue;
              backward[i]![j]! += backward[i + a]![j + b]! * (p.get(key(s.slice(i, i + a), t.slice(j, j + b))) ?? 0);
            }
          }
        }
      }
      const total = forward[n]![m]!;
      if (total === 0) continue;
      for (const [i, j, a, b] of steps(s, t)) {
        const k = key(s.slice(i - a, i), t.slice(j - b, j));
        const share = (forward[i - a]![j - b]! * (p.get(k) ?? 0) * backward[i]![j]!) / total;
        if (share > 0) expected.set(k, (expected.get(k) ?? 0) + share);
      }
    }
    const sum = [...expected.values()].reduce((x, y) => x + y, 0);
    p = new Map([...expected].map(([k, v]) => [k, v / sum]));
  }

  // Each pair's likeliest alignment.
  return pairs.map(([s, t]) => {
    const n = s.length;
    const m = t.length;
    const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(-Infinity));
    const back: (readonly [number, number] | null)[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
    best[0]![0] = 0;
    for (const [i, j, a, b] of steps(s, t)) {
      const prob = p.get(key(s.slice(i - a, i), t.slice(j - b, j)));
      if (!prob) continue;
      const score = best[i - a]![j - b]! + Math.log(prob);
      if (score > best[i]![j]!) {
        best[i]![j] = score;
        back[i]![j] = [a, b];
      }
    }
    const out: Graphone[] = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      const step = back[i]![j];
      if (!step) return [];
      out.unshift([s.slice(i - step[0], i), t.slice(j - step[1], j)]);
      i -= step[0];
      j -= step[1];
    }
    return out;
  });
}

/** Trains the model: aligns the pairs, then counts the graphone n-grams. */
export function train(pairs: readonly [string, string][], order = 4): Model {
  const aligned = align(pairs).filter((seq) => seq.length > 0);
  const ids = new Map<string, number>();
  const graphones: Graphone[] = [];
  const idOf = (g: Graphone) => {
    const k = `${g[0]}\u0000${g[1]}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = graphones.length;
      ids.set(k, id);
      graphones.push(g);
    }
    return id;
  };
  const counts: Record<string, number> = {};
  const seen: Record<string, Set<number>> = {};
  for (const seq of aligned) {
    const tokens = [...Array(order - 1).fill(EDGE), ...seq.map(idOf), EDGE] as number[];
    for (let i = order - 1; i < tokens.length; i++) {
      for (let k = 0; k < order; k++) {
        const history = tokens.slice(i - k, i).join(" ");
        const gram = `${history ? `${history} ` : ""}${tokens[i]}`;
        counts[gram] = (counts[gram] ?? 0) + 1;
        (seen[history] ??= new Set()).add(tokens[i]!);
      }
    }
  }
  const followers = Object.fromEntries(Object.entries(seen).map(([h, s]) => [h, s.size]));
  return { order, graphones, counts, followers };
}

/** The probability of a graphone after a history, Witten-Bell smoothed down to the unigram. */
function probability(model: Model, history: number[], next: number, totals: Map<string, number>): number {
  const vocabulary = model.graphones.length + 1;
  const unigramTotal = totals.get("") ?? 0;
  let p = ((model.counts[String(next)] ?? 0) + 1) / (unigramTotal + vocabulary);
  for (let k = 1; k <= history.length; k++) {
    const h = history.slice(history.length - k).join(" ");
    const seenAfter = model.followers[h] ?? 0;
    const total = totals.get(h) ?? 0;
    if (total === 0) continue;
    p = ((model.counts[`${h} ${next}`] ?? 0) + seenAfter * p) / (total + seenAfter);
  }
  return p;
}

/** How often each history was seen, which the smoothing needs; worked out once per model. */
function totalsOf(model: Model): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [gram, c] of Object.entries(model.counts)) {
    const parts = gram.split(" ");
    const history = parts.slice(0, -1).join(" ");
    totals.set(history, (totals.get(history) ?? 0) + c);
  }
  return totals;
}

const cache = new WeakMap<Model, { totals: Map<string, number>; bySource: Map<string, number[]> }>();
function prepared(model: Model) {
  let ready = cache.get(model);
  if (!ready) {
    const bySource = new Map<string, number[]>();
    model.graphones.forEach(([s], id) => bySource.set(s, [...(bySource.get(s) ?? []), id]));
    ready = { totals: totalsOf(model), bySource };
    cache.set(model, ready);
  }
  return ready;
}

/**
 * The likeliest spellings of a word, best first, with their log probabilities. A beam
 * search over the graphones that read it; an inserted letter (a graphone reading nothing)
 * can't follow another, so a spelling can't grow without end.
 */
export function spell(model: Model, source: string, { top = 3, beam = 48 } = {}): { text: string; logp: number }[] {
  const { totals, bySource } = prepared(model);
  type Hyp = { at: number; history: number[]; text: string; logp: number; inserted: boolean };
  let hyps: Hyp[] = [{ at: 0, history: Array(model.order - 1).fill(EDGE), text: "", logp: 0, inserted: false }];
  const done = new Map<string, number>();
  for (let step = 0; step < source.length * 3 + 3 && hyps.length > 0; step++) {
    const next: Hyp[] = [];
    for (const h of hyps) {
      if (h.at === source.length) {
        const logp = h.logp + Math.log(probability(model, h.history, EDGE, totals));
        if (logp > (done.get(h.text) ?? -Infinity)) done.set(h.text, logp);
      }
      for (let a = 0; a <= Math.min(MAX_SOURCE, source.length - h.at); a++) {
        if (a === 0 && h.inserted) continue;
        for (const id of bySource.get(source.slice(h.at, h.at + a)) ?? []) {
          const [, target] = model.graphones[id]!;
          next.push({
            at: h.at + a,
            history: [...h.history.slice(1), id],
            text: h.text + target,
            logp: h.logp + Math.log(probability(model, h.history, id, totals)),
            inserted: a === 0,
          });
        }
      }
    }
    // Keep the best of each state, then the best states.
    const byState = new Map<string, Hyp>();
    for (const h of next) {
      const k = `${h.at}|${h.history.join(",")}|${h.text}`;
      const held = byState.get(k);
      if (!held || h.logp > held.logp) byState.set(k, h);
    }
    hyps = [...byState.values()].sort((x, y) => y.logp - x.logp).slice(0, beam);
  }
  return [...done].map(([text, logp]) => ({ text, logp })).sort((x, y) => y.logp - x.logp).slice(0, top);
}
