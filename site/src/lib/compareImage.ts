/**
 * The compare page as a picture to post: 1080 × 1350, the portrait size the phone apps show
 * whole, drawn at twice that for sharp text. It is drawn straight onto a canvas with the
 * page's own fonts and theme colours, from the same figures, scales and marks the page uses.
 */
import type { Commune, Loaded } from "../components/Compare";
import type { Locale } from "../i18n/ui";
import { ARROW, ARROW_BOX, ARROW_STROKE, type ArrowDirection } from "./arrow";
import { FIGURES, formatValue, GROUPS, positionOf, shapePath, tickLabel, ticksOf, type Group, type View } from "./compare";

interface Options {
  view: View;
  locale: Locale;
  picked: Commune[];
  data: Loaded;
  x: string;
  y: string;
  figures: Record<string, string>;
  groups: Record<Group, string>;
  copy: { compareMorocco: string; compareEvery: string; compareImageSource: string };
  title: string;
  brand: string;
  link: string;
}

const W = 1080;
const H = 1350;
const PAD = 72;
const SCALE = 2;

interface Palette {
  paper: string;
  ink: string;
  quiet: string;
  rule: string;
  marks: string[];
}

function palette(): Palette {
  const host = document.querySelector(".cmp") ?? document.documentElement;
  const style = getComputedStyle(host);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: v("--paper", "#f1efe9"),
    ink: v("--ink", "#191d19"),
    quiet: v("--quiet", "#5f6660"),
    rule: v("--rule", "#dcd9d0"),
    marks: [0, 1, 2, 3].map((i) => v(`--cmp-${i}`, "#0f8266")),
  };
}

const SANS = '"Instrument Sans", system-ui, sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

function arrow(ctx: CanvasRenderingContext2D, dir: ArrowDirection, x: number, y: number, size: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / ARROW_BOX, size / ARROW_BOX);
  ctx.lineWidth = ARROW_STROKE;
  ctx.lineJoin = "miter";
  ctx.strokeStyle = colour;
  ctx.stroke(new Path2D(ARROW[dir]));
  ctx.restore();
}

function mark(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, r: number, colour: string, paper: string) {
  ctx.save();
  ctx.translate(x, y);
  const path = new Path2D(shapePath(index, r));
  ctx.lineWidth = 3;
  ctx.strokeStyle = paper;
  ctx.stroke(path);
  ctx.fillStyle = colour;
  ctx.fill(path);
  ctx.restore();
}

/** The names, each after its mark, wrapping onto a second line when they don't fit. Returns the y below them. */
function heading(ctx: CanvasRenderingContext2D, o: Options, p: Palette, top: number): number {
  ctx.textBaseline = "alphabetic";
  if (!o.picked.length) {
    ctx.font = `400 68px ${SERIF}`;
    ctx.fillStyle = p.ink;
    ctx.fillText(o.title, PAD, top + 60);
    return top + 92;
  }
  const size = o.picked.length > 2 ? 54 : 68;
  ctx.font = `400 ${size}px ${SERIF}`;
  let x = PAD;
  let y = top + size * 0.88;
  o.picked.forEach((c, i) => {
    const width = ctx.measureText(c.name).width + size * 0.62;
    if (x > PAD && x + width > W - PAD) {
      x = PAD;
      y += size * 1.12;
    }
    mark(ctx, i, x + size * 0.18, y - size * 0.3, size * 0.16, p.marks[i]!, p.paper);
    ctx.fillStyle = p.ink;
    ctx.fillText(c.name, x + size * 0.44, y);
    x += width + size * 0.3;
  });
  return y + size * 0.42;
}

function footer(ctx: CanvasRenderingContext2D, o: Options, p: Palette) {
  ctx.font = `400 22px ${SANS}`;
  ctx.fillStyle = p.quiet;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(o.link, PAD, H - 44);
  ctx.textAlign = "right";
  ctx.fillText(o.copy.compareImageSource, W - PAD, H - 44);
  ctx.textAlign = "left";
  ctx.strokeStyle = p.rule;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, H - 84);
  ctx.lineTo(W - PAD, H - 84);
  ctx.stroke();
}

function side(ctx: CanvasRenderingContext2D, o: Options, p: Palette, top: number) {
  // Each row is a label line, then the strip under it; the marks keep inside their own row.
  const bottom = H - 112;
  const headingHeight = 30;
  const row = (bottom - top - GROUPS.length * headingHeight) / FIGURES.length;
  const strip = 13;
  const sx = PAD;
  const sw = W - 2 * PAD;
  let y = top;
  for (const group of GROUPS) {
    ctx.font = `600 15px ${SANS}`;
    ctx.fillStyle = p.quiet;
    ctx.textAlign = "left";
    ctx.fillText(o.groups[group].toUpperCase(), PAD, y + 19);
    y += headingHeight;
    FIGURES.forEach((f, i) => {
      if (f.group !== group) return;
      const axis = o.data.axes[i]!;
      const bins = o.data.bins[i]!;
      const tallest = Math.max(...bins, 1);
      const baseline = y + 20;
      ctx.font = `400 21px ${SANS}`;
      ctx.fillStyle = p.ink;
      ctx.textAlign = "left";
      ctx.fillText(o.figures[f.id] ?? f.id, PAD, baseline);
      // The values, right-aligned, the last commune nearest the edge.
      ctx.textAlign = "right";
      ctx.font = `500 21px ${SANS}`;
      let vx = W - PAD;
      for (let k = o.picked.length - 1; k >= 0; k--) {
        const text = formatValue(o.locale, f.unit, o.picked[k]!.values[i] ?? null);
        ctx.fillStyle = p.ink;
        ctx.fillText(text, vx, baseline);
        const w = ctx.measureText(text).width;
        mark(ctx, k, vx - w - 12, baseline - 7, 5, p.marks[k]!, p.paper);
        vx -= w + 38;
      }
      ctx.textAlign = "left";
      // The spread of every commune, Morocco's line, then each commune's mark.
      const sy = y + 29;
      ctx.fillStyle = p.quiet;
      ctx.globalAlpha = 0.3;
      bins.forEach((n, b) => {
        if (!n) return;
        const h = Math.max(1.5, (n / tallest) * strip);
        ctx.fillRect(sx + (b / bins.length) * sw + 1, sy + strip - h, sw / bins.length - 2, h);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.rule;
      ctx.fillRect(sx, sy + strip, sw, 1.5);
      const morocco = o.data.morocco[i] ?? null;
      if (morocco !== null) {
        ctx.fillStyle = p.ink;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(sx + positionOf(morocco, axis) * sw - 1, sy - 3, 2, strip + 3);
        ctx.globalAlpha = 1;
      }
      o.picked.forEach((c, k) => {
        const v = c.values[i];
        if (v == null) return;
        const lane = (k - (o.picked.length - 1) / 2) * 5;
        mark(ctx, k, sx + positionOf(v, axis) * sw, sy + strip / 2 + lane, 6, p.marks[k]!, p.paper);
      });
      y += row;
    });
  }
}

function scatter(ctx: CanvasRenderingContext2D, o: Options, p: Palette, top: number) {
  const xi = FIGURES.findIndex((f) => f.id === o.x);
  const yi = FIGURES.findIndex((f) => f.id === o.y);
  const fx = FIGURES[xi]!;
  const fy = FIGURES[yi]!;
  const ax = o.data.axes[xi]!;
  const ay = o.data.axes[yi]!;
  const left = PAD + 64;
  const right = W - PAD;
  const plotTop = top + 56;
  const plotBottom = H - 170;
  const px = (v: number) => left + positionOf(v, ax) * (right - left);
  const py = (v: number) => plotBottom - positionOf(v, ay) * (plotBottom - plotTop);

  ctx.font = `400 22px ${SANS}`;
  ctx.lineWidth = 1.5;
  for (const t of ticksOf(ax)) {
    ctx.strokeStyle = p.rule;
    ctx.beginPath();
    ctx.moveTo(px(t), plotTop);
    ctx.lineTo(px(t), plotBottom);
    ctx.stroke();
    ctx.fillStyle = p.quiet;
    ctx.textAlign = "center";
    ctx.fillText(tickLabel(o.locale, fx.unit, t), px(t), plotBottom + 32);
  }
  for (const t of ticksOf(ay)) {
    ctx.strokeStyle = p.rule;
    ctx.beginPath();
    ctx.moveTo(left, py(t));
    ctx.lineTo(right, py(t));
    ctx.stroke();
    ctx.fillStyle = p.quiet;
    ctx.textAlign = "right";
    ctx.fillText(tickLabel(o.locale, fy.unit, t), left - 12, py(t) + 8);
  }
  ctx.textAlign = "left";
  ctx.font = `500 24px ${SANS}`;
  ctx.fillStyle = p.ink;
  // The site's arrow at 0.75em of the 24px titles, beside each one.
  const size = 18;
  arrow(ctx, "up", left, plotTop - 22 - size, size, p.ink);
  ctx.fillText(o.figures[fy.id] ?? fy.id, left + size + 8, plotTop - 22);
  ctx.textAlign = "right";
  ctx.fillText(o.figures[fx.id] ?? fx.id, right - size - 8, plotBottom + 72);
  arrow(ctx, "right", right - size, plotBottom + 72 - size, size, p.ink);
  ctx.textAlign = "left";

  const mx = o.data.morocco[xi] ?? null;
  const my = o.data.morocco[yi] ?? null;
  if (mx !== null && my !== null) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = p.quiet;
    ctx.beginPath();
    ctx.moveTo(px(mx), plotTop);
    ctx.lineTo(px(mx), plotBottom);
    ctx.moveTo(left, py(my));
    ctx.lineTo(right, py(my));
    ctx.stroke();
    ctx.restore();
    ctx.font = `400 20px ${SANS}`;
    ctx.fillStyle = p.quiet;
    ctx.fillText(o.copy.compareMorocco, px(mx) + 8, plotTop + 20);
  }

  ctx.fillStyle = p.quiet;
  ctx.globalAlpha = 0.4;
  for (const c of o.data.communes) {
    const a = c.values[xi];
    const b = c.values[yi];
    if (a == null || b == null) continue;
    ctx.beginPath();
    ctx.arc(px(a), py(b), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const placed: { x: number; ly: number }[] = [];
  o.picked.forEach((c, k) => {
    const a = c.values[xi];
    const b = c.values[yi];
    if (a == null || b == null) return;
    const x = px(a);
    const y = py(b);
    mark(ctx, k, x, y, 11, p.marks[k]!, p.paper);
    let ly = y;
    for (const other of placed) if (Math.abs(other.ly - ly) < 30 && Math.abs(other.x - x) < 260) ly = other.ly + 30;
    placed.push({ x, ly });
    const rightSide = x < W - 300;
    ctx.font = `600 26px ${SANS}`;
    ctx.textAlign = rightSide ? "left" : "right";
    ctx.lineWidth = 6;
    ctx.strokeStyle = p.paper;
    ctx.lineJoin = "round";
    const tx = rightSide ? x + 20 : x - 20;
    ctx.strokeText(c.name, tx, ly + 9);
    ctx.fillStyle = p.ink;
    ctx.fillText(c.name, tx, ly + 9);
    ctx.textAlign = "left";
  });
}

export async function drawCompare(o: Options): Promise<Blob> {
  await Promise.all([document.fonts.load(`400 40px ${SERIF}`), document.fonts.load(`400 20px ${SANS}`), document.fonts.load(`600 20px ${SANS}`)]).catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  const p = palette();
  ctx.fillStyle = p.paper;
  ctx.fillRect(0, 0, W, H);

  ctx.font = `400 26px ${SERIF}`;
  ctx.fillStyle = p.quiet;
  ctx.fillText(o.brand, PAD, PAD + 8);
  const below = heading(ctx, o, p, PAD + 34);
  if (o.view === "scatter") scatter(ctx, o, p, below);
  else side(ctx, o, p, below + 8);
  footer(ctx, o, p);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png"));
}
