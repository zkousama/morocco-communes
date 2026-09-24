/**
 * The arithmetic later tasks share: a seeded generator for reproducible permutations and
 * placebo choices, the tests a link runs across a level's places, the Benjamini-Hochberg
 * correction a batch of link tests is judged by, a Wilson interval and a kappa for the
 * grading tasks still to come.
 */

/** mulberry32: a small, fast, seedable generator. Same seed, same stream, every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, in place, driven by an already-seeded generator. */
function shuffle<T>(values: T[], random: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const vi = values[i]!;
    values[i] = values[j]!;
    values[j] = vi;
  }
}

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * 1-based ranks, tied values sharing the average of the ranks they span (a Spearman rank,
 * not a plain sort position).
 */
function ranksOf(values: number[]): number[] {
  const n = values.length;
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]!] === values[order[i]!]) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/** Pearson's r, given the two arrays already line up index for index. */
function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman's rho: Pearson's r of the two arrays' ranks. */
export function spearman(x: number[], y: number[]): number {
  return pearson(ranksOf(x), ranksOf(y));
}

/**
 * The share of `rounds` reshuffles of `y` whose rank correlation with `x` reaches the
 * observed `|rho|`, the usual +1 added to both the count and the round total so a result
 * of 0 hits is never reported as impossible. Both arrays are ranked once; a round reorders
 * a copy of `y`'s ranks rather than re-ranking or re-sorting anything.
 */
export function permutationP(x: number[], y: number[], rho: number, rounds: number, seed: number): number {
  const rankX = ranksOf(x);
  const rankY = ranksOf(y);
  const mx = mean(rankX);
  const my = mean(rankY);
  const dx = rankX.map((v) => v - mx);
  const dyBase = rankY.map((v) => v - my);
  const sxx = dx.reduce((sum, v) => sum + v * v, 0);
  const syy = dyBase.reduce((sum, v) => sum + v * v, 0);
  const denom = Math.sqrt(sxx * syy);
  const observed = Math.abs(rho);

  const random = rng(seed);
  const shuffled = dyBase.slice();
  let hits = 0;
  for (let round = 0; round < rounds; round++) {
    shuffle(shuffled, random);
    let sxy = 0;
    for (let i = 0; i < dx.length; i++) sxy += dx[i]! * shuffled[i]!;
    if (Math.abs(sxy / denom) >= observed) hits++;
  }
  return (hits + 1) / (rounds + 1);
}

/** The standard normal CDF, via the Abramowitz-Stegun approximation of erf. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * The Mann-Whitney U test's normal approximation, corrected for ties, two-sided. Ranks the
 * pooled sample once, averaging ranks within a tie, then reads `a`'s U off the rank sums.
 */
export function mannWhitneyP(a: number[], b: number[]): number {
  const n1 = a.length;
  const n2 = b.length;
  const total = n1 + n2;
  const pooled = [...a.map((v) => ({ v, group: 0 })), ...b.map((v) => ({ v, group: 1 }))];
  const order = pooled.map((_, i) => i).sort((i, j) => pooled[i]!.v - pooled[j]!.v);

  const ranks = new Array<number>(total);
  let tieSum = 0;
  let i = 0;
  while (i < total) {
    let j = i;
    while (j + 1 < total && pooled[order[j + 1]!]!.v === pooled[order[i]!]!.v) j++;
    const averageRank = (i + j) / 2 + 1;
    const tieSize = j - i + 1;
    tieSum += tieSize ** 3 - tieSize;
    for (let k = i; k <= j; k++) ranks[order[k]!] = averageRank;
    i = j + 1;
  }

  const rankSumA = pooled.reduce((sum, p, idx) => (p.group === 0 ? sum + ranks[idx]! : sum), 0);
  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const meanU = (n1 * n2) / 2;
  const sdU = Math.sqrt(((n1 * n2) / 12) * (total + 1 - tieSum / (total * (total - 1))));
  if (sdU === 0) return 1;
  const z = (u1 - meanU) / sdU;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** Which p-values are discoveries under the Benjamini-Hochberg procedure at level `q`. */
export function benjaminiHochberg(ps: number[], q: number): boolean[] {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  let cut = -1;
  order.forEach(([p], k) => {
    if (p <= ((k + 1) / ps.length) * q) cut = k;
  });
  const found = new Array(ps.length).fill(false);
  for (let k = 0; k <= cut; k++) found[order[k]![1]] = true;
  return found;
}

/** A Wilson score interval for `successes` out of `n`, `z` defaulting to a 95% interval. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: centre - half, high: centre + half };
}

/** Cohen's kappa over whichever labels appear in either array; 0, not NaN, when chance agreement is total. */
export function cohenKappa(a: string[], b: string[]): number {
  const n = a.length;
  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  let agree = 0;
  for (let i = 0; i < n; i++) {
    countsA.set(a[i]!, (countsA.get(a[i]!) ?? 0) + 1);
    countsB.set(b[i]!, (countsB.get(b[i]!) ?? 0) + 1);
    if (a[i] === b[i]) agree++;
  }
  const labels = new Set([...a, ...b]);
  let expected = 0;
  for (const label of labels) expected += ((countsA.get(label) ?? 0) / n) * ((countsB.get(label) ?? 0) / n);
  if (expected === 1) return 0;
  const observed = agree / n;
  return (observed - expected) / (1 - expected);
}
