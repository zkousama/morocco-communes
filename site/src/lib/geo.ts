/**
 * Drawing helpers for the maps on the site: simplification and a projection, shared by
 * the hero map and the locator maps on the commune pages.
 */
export type Point = [number, number];

/**
 * Perpendicular-distance simplification, iterative so a long line can't blow the stack.
 * Both end points are always kept, so arcs simplified one at a time still meet.
 */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let index = -1;
    const [ax, ay] = points[first]!;
    const [bx, by] = points[last]!;
    const dx = bx - ax;
    const dy = by - ay;
    const norm = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]!;
      let d: number;
      if (norm === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        let t = ((px - ax) * dx + (py - ay) * dy) / norm;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance * tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Plate carrée with the x axis scaled by the cosine of the middle latitude, fitted to a
 * box `width` wide. Across one province, or across Morocco's 15° of latitude, the
 * distortion a real projection would remove is smaller than the lines drawn.
 */
export function fit(box: [number, number, number, number], width: number, precision = 0) {
  const [minLng, minLat, maxLng, maxLat] = box;
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = width / Math.max((maxLng - minLng) * kx, maxLat - minLat);
  const factor = 10 ** precision;
  const round = (n: number) => Math.round(n * factor) / factor;
  return {
    height: round((maxLat - minLat) * scale),
    width: round((maxLng - minLng) * kx * scale),
    /** Degrees per unit, for a simplification tolerance in units. */
    unit: 1 / scale,
    project: ([lng, lat]: Point): Point => [round((lng - minLng) * kx * scale), round((maxLat - lat) * scale)],
  };
}

/**
 * An SVG path through projected points, dropping repeats that rounding creates. After the
 * first point each step is relative, which on integer coordinates is about a third shorter.
 */
export function pathOf(points: Point[], close: boolean): string {
  let d = "";
  let px = Number.NaN;
  let py = Number.NaN;
  // Differences of rounded numbers still carry float noise, 0.6000000000000001, so each
  // step is rounded again to the precision the points were projected at.
  const step = (v: number) => String(Math.round(v * 1000) / 1000);
  for (const [x, y] of points) {
    if (x === px && y === py) continue;
    d += d === "" ? `M${x} ${y}l` : `${step(x - px)} ${step(y - py)} `;
    px = x;
    py = y;
  }
  if (d === "") return d;
  d = d.trimEnd().replace(/l$/, "");
  return close ? `${d}z` : d;
}

export function boxOf(rings: Point[][]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}
