/**
 * Zoom and pan for the home map, as arithmetic on what the map shows. The map is drawn by
 * its SVG viewBox, so zooming in is showing a smaller box of the same drawing rather than
 * scaling a picture of it, and it stays sharp at every zoom.
 *
 * Nothing here touches the page. These work out views and points, and Map.astro writes
 * the view to the viewBox once a frame.
 */

/** The whole map, in its own units: the viewBox it was generated with. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the map shows: how far in, and the map point at the frame's top left corner. */
export interface View {
  k: number;
  x: number;
  y: number;
}

/** Where the map is drawn, in CSS pixels, as getBoundingClientRect gives it. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 12;

export const parseBox = (viewBox: string): Box => {
  const [x = 0, y = 0, width = 1, height = 1] = viewBox.split(/[\s,]+/).map(Number);
  return { x, y, width, height };
};

export const whole = (box: Box): View => ({ k: MIN_ZOOM, x: box.x, y: box.y });

/** The zoom held to 1x to 12x, and the frame held inside the map. */
export const clamp = (view: View, box: Box): View => {
  const k = Math.min(Math.max(view.k, MIN_ZOOM), MAX_ZOOM);
  const width = box.width / k;
  const height = box.height / k;
  return {
    k,
    x: Math.min(Math.max(view.x, box.x), box.x + box.width - width),
    y: Math.min(Math.max(view.y, box.y), box.y + box.height - height),
  };
};

/** The map point under a point on the screen. */
export const toMap = (view: View, box: Box, rect: Rect, p: Point): Point => ({
  x: view.x + ((p.x - rect.left) / rect.width) * (box.width / view.k),
  y: view.y + ((p.y - rect.top) / rect.height) * (box.height / view.k),
});

/** Where a map point is drawn on the screen. */
export const toScreen = (view: View, box: Box, rect: Rect, p: Point): Point => ({
  x: rect.left + ((p.x - view.x) / (box.width / view.k)) * rect.width,
  y: rect.top + ((p.y - view.y) / (box.height / view.k)) * rect.height,
});

/** Zoomed to k, with the map point under p still under p. */
export const zoomAt = (view: View, box: Box, rect: Rect, p: Point, k: number): View => {
  const anchor = toMap(view, box, rect, p);
  const next = Math.min(Math.max(k, MIN_ZOOM), MAX_ZOOM);
  return clamp(
    {
      k: next,
      x: anchor.x - ((p.x - rect.left) / rect.width) * (box.width / next),
      y: anchor.y - ((p.y - rect.top) / rect.height) * (box.height / next),
    },
    box,
  );
};

/** Dragged by dx, dy screen pixels, so the map moves with the pointer. */
export const panBy = (view: View, box: Box, rect: Rect, dx: number, dy: number): View =>
  clamp(
    {
      k: view.k,
      x: view.x - (dx / rect.width) * (box.width / view.k),
      y: view.y - (dy / rect.height) * (box.height / view.k),
    },
    box,
  );

type Pair = [Point, Point];

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** How much 2 fingers spread since they came down: 2 when they're twice as far apart. */
export const pinchScale = (from: Pair, to: Pair): number => {
  const start = distance(...from);
  return start < 1e-6 ? 1 : distance(...to) / start;
};

/**
 * The view a pinch gives, from the view it started on: zoomed by the fingers' spread, with
 * the map point that was between them when they came down still between them.
 */
export const pinch = (start: View, box: Box, rect: Rect, from: Pair, to: Pair): View => {
  const anchor = toMap(start, box, rect, midpoint(...from));
  const now = midpoint(...to);
  const k = Math.min(Math.max(start.k * pinchScale(from, to), MIN_ZOOM), MAX_ZOOM);
  return clamp(
    {
      k,
      x: anchor.x - ((now.x - rect.left) / rect.width) * (box.width / k),
      y: anchor.y - ((now.y - rect.top) / rect.height) * (box.height / k),
    },
    box,
  );
};

const round = (v: number) => String(+v.toFixed(3));

/** The viewBox attribute for a view, in the map's own proportions. */
export const viewBoxOf = (view: View, box: Box): string =>
  [view.x, view.y, box.width / view.k, box.height / view.k].map(round).join(" ");

/**
 * A step of the way from one view to another, t from 0 to 1. The zoom changes by the same
 * factor each step, and the map point that both views draw at the same place on screen
 * stays there the whole way.
 */
export const between = (a: View, b: View, box: Box, t: number): View => {
  const k = a.k * (b.k / a.k) ** t;
  // How far the frame's size has gone from a's to b's, 0 to 1. At one zoom, the time.
  const share = Math.abs(b.k - a.k) < 1e-9 ? t : (1 / a.k - 1 / k) / (1 / a.k - 1 / b.k);
  return clamp({ k, x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share }, box);
};

/**
 * The zoom factor for one wheel event with Ctrl or ⌘ held. Chrome sends a trackpad pinch
 * as that, with deltaY -100 ln(scale), so this follows a pinch exactly; one notch of a
 * mouse wheel is held to 2x.
 */
export const wheelZoom = (deltaY: number, deltaMode: number): number => {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  return Math.min(Math.max(Math.exp(-pixels / 100), 0.5), 2);
};
