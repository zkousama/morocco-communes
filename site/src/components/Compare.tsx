import { batch, createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, onMount, Show } from "solid-js";
import type { Locale } from "../i18n/ui";
import {
  axisOf,
  DEFAULT_STATE,
  FIGURES,
  fitLabels,
  formatValue,
  GROUPS,
  histogram,
  matchCommunes,
  MAX_COMMUNES,
  nearest,
  parseState,
  positionOf,
  queryOf,
  searchKeys,
  shapePath,
  standing,
  tickLabel,
  ticksOf,
  VALUES_FROM,
  type Axis,
  type CompareData,
  type Group,
  type State,
} from "../lib/compare";
import { ARROW, ARROW_BOX } from "../lib/arrow";
import { percent } from "../lib/format";
import { placeTip } from "../lib/tip";

/** The strings this island shows. Only these are serialised into the page for it. */
export const COMPARE_KEYS = [
  "compareAdd",
  "compareFull",
  "compareRemove",
  "compareNone",
  "compareFew",
  "compareSpecial",
  "compareUrban",
  "compareRural",
  "compareSide",
  "compareScatter",
  "compareAcross",
  "compareUp",
  "compareSwap",
  "compareMorocco",
  "compareEvery",
  "compareDots",
  "compareTry",
  "compareAnd",
  "compareEmpty",
  "compareCopy",
  "compareCopied",
  "compareShare",
  "compareSave",
  "compareSaving",
  "compareLoading",
  "compareFailed",
  "compareAbove",
  "compareBelow",
  "compareImageSource",
] as const;

type Copy = Record<(typeof COMPARE_KEYS)[number], string>;

interface Props {
  locale: Locale;
  copy: Copy;
  figures: Record<string, string>;
  groups: Record<Group, string>;
  /** Where commune pages live in this language, "/communes/" or "/fr/communes/". */
  communeBase: string;
  title: string;
  /** The site's name, for the corner of a saved picture. */
  brand: string;
}

export interface Commune {
  slug: string;
  name: string;
  ar: string;
  province: string;
  urban: boolean;
  people: number;
  values: (number | null)[];
  key: string;
  arKey: string;
  skel: string;
  excluded?: "few" | "special";
}

interface Loaded {
  communes: Commune[];
  bySlug: Map<string, Commune>;
  excluded: Commune[];
  morocco: (number | null)[];
  columns: (number | null)[][];
  axes: Axis[];
  bins: number[][];
}

const BINS = 28;
/** Pairs worth a first look: twins far apart, and the two largest cities. */
const SUGGESTED = [
  ["agadir", "kenitra"],
  ["tafraout", "nador"],
  ["casablanca", "rabat"],
];

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

function load(raw: CompareData): Loaded {
  const count = raw.figures.indexOf("population");
  const communes: Commune[] = raw.communes.map((row) => {
    const values = row.slice(VALUES_FROM) as (number | null)[];
    return {
      slug: row[0],
      name: row[1],
      ar: row[2],
      province: raw.provinces[row[3]] ?? "",
      urban: row[4] === "u",
      people: (values[count] as number | null) ?? 0,
      values,
      ...searchKeys(row[1], row[2]),
    };
  });
  const excluded: Commune[] = raw.excluded.map(([slug, name, why]) => ({
    slug,
    name,
    ar: "",
    province: "",
    urban: false,
    people: 0,
    values: [],
    ...searchKeys(name, ""),
    excluded: why,
  }));
  const columns = FIGURES.map((_, i) => communes.map((c) => c.values[i] ?? null));
  const axes = FIGURES.map((f, i) => axisOf(f, columns[i]!));
  return {
    communes,
    bySlug: new Map(communes.map((c) => [c.slug, c])),
    excluded,
    morocco: raw.morocco,
    columns,
    axes,
    bins: FIGURES.map((_, i) => histogram(columns[i]!, axes[i]!, BINS)),
  };
}

function Glyph(props: { i: number; size?: number }) {
  const size = () => props.size ?? 12;
  return (
    <svg class={`cmp-glyph k${props.i}`} width={size()} height={size()} viewBox="-7 -7 14 14" aria-hidden="true">
      <path d={shapePath(props.i, 4.8)} />
    </svg>
  );
}

/** What a tooltip says: a name, a quiet line under it, figures with their values, and a closing note. */
interface TipContent {
  x: number;
  y: number;
  title: string;
  sub?: string;
  rows: [string, string][];
  note?: string;
}

/**
 * The home map's tooltip, for this page: a paper card beside the point it names, kept inside
 * its frame by the same placement. `fixed` places it in the window rather than a box.
 */
function Tip(props: { tip: TipContent | null; frame: () => { width: number; height: number }; fixed?: boolean }) {
  let card: HTMLDivElement | undefined;
  createEffect(() => {
    const t = props.tip;
    if (!t || !card) return;
    const at = placeTip({ x: t.x, y: t.y }, { width: card.offsetWidth, height: card.offsetHeight }, props.frame(), null);
    card.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
  });
  return (
    <Show when={props.tip}>
      {(t) => (
        <div ref={card} class="cmp-tip" classList={{ "is-fixed": Boolean(props.fixed) }} role="tooltip">
          <strong>{t().title}</strong>
          <Show when={t().sub}>
            <span>{t().sub}</span>
          </Show>
          <For each={t().rows}>
            {([label, value]) => (
              <span class="cmp-tip-row">
                <span>{label}</span>
                <b>{value}</b>
              </span>
            )}
          </For>
          <Show when={t().note}>
            <span>{t().note}</span>
          </Show>
        </div>
      )}
    </Show>
  );
}

export default function Compare(props: Props) {
  const copy = props.copy;
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [state, setState] = createSignal<State>(DEFAULT_STATE);
  const [notes, setNotes] = createSignal<string[]>([]);

  const noteOf = (c: Commune) => fill(c.excluded === "few" ? copy.compareFew : copy.compareSpecial, { name: c.name });

  onMount(async () => {
    try {
      const response = await fetch("/compare/data.json");
      if (!response.ok) throw new Error(String(response.status));
      const data = load((await response.json()) as CompareData);
      const asked = (new URLSearchParams(location.search).get("c") ?? "").split(",");
      batch(() => {
        setLoaded(data);
        setState(parseState(location.search, new Set(data.bySlug.keys())));
        setNotes(asked.flatMap((slug) => data.excluded.filter((c) => c.slug === slug).map(noteOf)));
      });
    } catch {
      setFailed(true);
    }
  });

  // The link always holds the comparison on screen, so copying the address shares it.
  createEffect(
    on(
      state,
      (s) => {
        if (!loaded()) return;
        history.replaceState(history.state, "", `${location.pathname}${queryOf(s)}`);
      },
      { defer: true },
    ),
  );

  const picked = createMemo(() => {
    const data = loaded();
    return data ? state().communes.flatMap((slug) => data.bySlug.get(slug) ?? []) : [];
  });
  const update = (change: Partial<State>) => setState({ ...state(), ...change });
  const add = (slug: string) => {
    const now = state().communes;
    if (now.includes(slug) || now.length >= MAX_COMMUNES) return;
    setNotes([]);
    update({ communes: [...now, slug] });
  };
  const remove = (slug: string) => update({ communes: state().communes.filter((s) => s !== slug) });

  return (
    <div class="cmp-app">
      <Show
        when={loaded()}
        fallback={<p class="cmp-status">{failed() ? copy.compareFailed : copy.compareLoading}</p>}
      >
        {(data) => (
          <>
            <div class="cmp-bar">
              <Picker data={data()} picked={picked()} add={add} remove={remove} copy={copy} communeBase={props.communeBase} />
              <div class="cmp-views" role="group">
                <button type="button" aria-pressed={state().view === "side"} onClick={() => update({ view: "side" })}>
                  {copy.compareSide}
                </button>
                <button type="button" aria-pressed={state().view === "scatter"} onClick={() => update({ view: "scatter" })}>
                  {copy.compareScatter}
                </button>
              </div>
            </div>
            <For each={notes()}>{(note) => <p class="cmp-note">{note}</p>}</For>
            <Show when={picked().length === 0}>
              <div class="cmp-empty">
                <p>{copy.compareEmpty}</p>
                <div class="cmp-suggestions">
                  <span>{copy.compareTry}</span>
                  <For each={SUGGESTED.filter((pair) => pair.every((slug) => data().bySlug.has(slug)))}>
                    {(pair) => (
                      <button type="button" class="cmp-suggest" onClick={() => update({ communes: pair })}>
                        {pair.map((slug) => data().bySlug.get(slug)!.name).join(` ${copy.compareAnd} `)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <Show
              when={state().view === "scatter"}
              fallback={<Side data={data()} picked={picked()} locale={props.locale} copy={copy} figures={props.figures} groups={props.groups} />}
            >
              <Scatter
                data={data()}
                picked={picked()}
                state={state()}
                update={update}
                add={add}
                locale={props.locale}
                copy={copy}
                figures={props.figures}
                groups={props.groups}
              />
            </Show>
            <Actions
              data={data()}
              picked={picked()}
              state={state()}
              locale={props.locale}
              copy={copy}
              figures={props.figures}
              groups={props.groups}
              title={props.title}
              brand={props.brand}
            />
          </>
        )}
      </Show>
    </div>
  );
}

// Picking communes -----------------------------------------------------------------

function Picker(props: {
  data: Loaded;
  picked: Commune[];
  add: (slug: string) => void;
  remove: (slug: string) => void;
  copy: Copy;
  communeBase: string;
}) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let input!: HTMLInputElement;
  const full = () => props.picked.length >= MAX_COMMUNES;
  const pool = createMemo(() => {
    const taken = new Set(props.picked.map((c) => c.slug));
    return [...props.data.communes.filter((c) => !taken.has(c.slug)), ...props.data.excluded];
  });
  const hits = createMemo(() => matchCommunes(pool(), query(), 8));
  const choose = (c: Commune | undefined) => {
    if (!c || c.excluded) return;
    props.add(c.slug);
    setQuery("");
    setActive(0);
    // Ready for the next one, unless that was the last there's room for.
    if (props.picked.length + 1 >= MAX_COMMUNES) {
      setOpen(false);
      input.blur();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const n = hits().length;
    if (event.key === "ArrowDown" && n) {
      event.preventDefault();
      setOpen(true);
      setActive((active() + 1) % n);
    } else if (event.key === "ArrowUp" && n) {
      event.preventDefault();
      setActive((active() - 1 + n) % n);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(hits()[active()]);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && !query() && props.picked.length) {
      props.remove(props.picked[props.picked.length - 1]!.slug);
    }
  };
  const meta = (c: Commune) => (c.excluded ? "" : `${c.province} · ${c.urban ? props.copy.compareUrban : props.copy.compareRural}`);

  return (
    <div class="cmp-picker">
      <ul class="cmp-chips">
        <For each={props.picked}>
          {(c, i) => (
            <li class={`cmp-chip k${i()}`}>
              <Glyph i={i()} />
              <a href={`${props.communeBase}${c.slug}/`}>{c.name}</a>
              <button type="button" aria-label={fill(props.copy.compareRemove, { name: c.name })} onClick={() => props.remove(c.slug)}>
                ×
              </button>
            </li>
          )}
        </For>
        <li class="cmp-add">
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded={open() && query().trim() !== ""}
            aria-controls="cmp-options"
            aria-activedescendant={open() && hits().length ? `cmp-option-${active()}` : undefined}
            aria-autocomplete="list"
            autocomplete="off"
            spellcheck={false}
            disabled={full()}
            placeholder={full() ? props.copy.compareFull : props.copy.compareAdd}
            aria-label={props.copy.compareAdd}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
          />
          <Show when={open() && query().trim() !== ""}>
            <ul class="cmp-options" id="cmp-options" role="listbox">
              <For each={hits()} fallback={<li class="cmp-option is-none">{props.copy.compareNone}</li>}>
                {(c, i) => (
                  <li
                    id={`cmp-option-${i()}`}
                    role="option"
                    aria-selected={i() === active()}
                    aria-disabled={c.excluded ? true : undefined}
                    class="cmp-option"
                    classList={{ "is-active": i() === active(), "is-off": Boolean(c.excluded) }}
                    // Before the input loses focus, or the list is gone before the click lands.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(c);
                    }}
                    onMouseEnter={() => setActive(i())}
                  >
                    <span class="cmp-option-name">{c.name}</span>
                    <span class="cmp-option-meta">
                      {c.excluded ? fill(c.excluded === "few" ? props.copy.compareFew : props.copy.compareSpecial, { name: c.name }) : meta(c)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </li>
      </ul>
    </div>
  );
}

// Side by side --------------------------------------------------------------------

function Side(props: {
  data: Loaded;
  picked: Commune[];
  locale: Locale;
  copy: Copy;
  figures: Record<string, string>;
  groups: Record<Group, string>;
}) {
  const lane = (i: number) => (i - (props.picked.length - 1) / 2) * 7;
  const [tip, setTip] = createSignal<TipContent | null>(null);
  // Said from whichever side is nearer: "lower than 95%" rather than "higher than 5%".
  const noteOf = (value: number, i: number) => {
    const { below, above } = standing(value, props.data.columns[i]!);
    const share = (n: number) => percent(props.locale, n, { digits: 0 });
    return below >= above ? fill(props.copy.compareAbove, { rank: share(below) }) : fill(props.copy.compareBelow, { rank: share(above) });
  };
  const viewport = () => ({ width: document.documentElement.clientWidth, height: window.innerHeight });
  const show = (x: number, y: number, c: Commune, i: number) => {
    const f = FIGURES[i]!;
    const value = c.values[i] ?? null;
    const morocco = props.data.morocco[i] ?? null;
    if (value === null) return;
    setTip({
      x,
      y,
      title: c.name,
      rows: [
        [props.figures[f.id] ?? f.id, formatValue(props.locale, f.unit, value)],
        ...(morocco === null ? [] : ([[props.copy.compareMorocco, formatValue(props.locale, f.unit, morocco)]] as [string, string][])),
      ],
      note: noteOf(value, i),
    });
  };
  const showMark = (mark: HTMLElement, c: Commune, i: number) => {
    const box = mark.getBoundingClientRect();
    show(box.left + box.width / 2, box.top + box.height / 2, c, i);
  };
  // Marks a few points apart overlap, so the strip, not the mark, takes the pointer: the card
  // is for whichever mark is nearest it, within reach.
  const pointAt = (event: PointerEvent | MouseEvent, i: number) => {
    const strip = event.currentTarget as HTMLElement;
    const box = strip.getBoundingClientRect();
    const reach = "pointerType" in event && event.pointerType !== "mouse" ? 30 : 18;
    let best: { c: Commune; x: number; y: number; d: number } | null = null;
    props.picked.forEach((c, k) => {
      const value = c.values[i];
      if (value == null) return;
      const x = box.left + positionOf(value, props.data.axes[i]!) * box.width;
      const y = box.top + box.height / 2 + lane(k);
      const d = Math.hypot(event.clientX - x, event.clientY - y);
      if (d <= reach && (!best || d < best.d)) best = { c, x, y, d };
    });
    const found = best as { c: Commune; x: number; y: number } | null;
    if (found) show(found.x, found.y, found.c, i);
    else setTip(null);
  };
  // The card is placed in the window, so it goes when the page moves under it, or a tap lands elsewhere.
  onMount(() => {
    const hide = () => setTip(null);
    const away = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.(".cmp-strip")) hide();
    };
    window.addEventListener("scroll", hide, { passive: true });
    document.addEventListener("pointerdown", away);
    onCleanup(() => {
      window.removeEventListener("scroll", hide);
      document.removeEventListener("pointerdown", away);
    });
  });
  return (
    <div class="cmp-side">
      <Tip tip={tip()} frame={viewport} fixed />
      <ul class="cmp-legend" aria-hidden="true">
        <li class="lg-morocco">
          <i />
          {props.copy.compareMorocco}
        </li>
        <li class="lg-every">
          <i />
          {props.copy.compareEvery}
        </li>
      </ul>
      <For each={GROUPS}>
        {(group) => (
          <section class="cmp-group">
            <h2>{props.groups[group]}</h2>
            <For each={FIGURES.map((f, i) => ({ f, i })).filter(({ f }) => f.group === group)}>
              {({ f, i }) => {
                const axis = props.data.axes[i]!;
                const bins = props.data.bins[i]!;
                const tallest = Math.max(...bins, 1);
                const morocco = props.data.morocco[i] ?? null;
                return (
                  <div class="cmp-row">
                    <div class="cmp-label">{props.figures[f.id]}</div>
                    <div class="cmp-values">
                      <For each={props.picked}>
                        {(c, k) => (
                          <span class={`v k${k()}`}>
                            <Glyph i={k()} size={10} />
                            {formatValue(props.locale, f.unit, c.values[i] ?? null)}
                          </span>
                        )}
                      </For>
                      <Show when={morocco !== null}>
                        <span class="v mo">
                          {props.copy.compareMorocco} {formatValue(props.locale, f.unit, morocco)}
                        </span>
                      </Show>
                    </div>
                    <div
                      class="cmp-strip"
                      onPointerMove={(e) => e.pointerType === "mouse" && pointAt(e, i)}
                      onPointerLeave={(e) => e.pointerType === "mouse" && setTip(null)}
                      onClick={(e) => pointAt(e, i)}
                    >
                      <svg class="cmp-bars" viewBox={`0 0 ${BINS} 10`} preserveAspectRatio="none" aria-hidden="true">
                        {bins.map((n, b) => {
                          const h = n === 0 ? 0 : Math.max(0.5, (n / tallest) * 10);
                          return <rect x={b + 0.08} y={10 - h} width={0.84} height={h} />;
                        })}
                      </svg>
                      <Show when={morocco !== null}>
                        <span class="cmp-mo" style={{ left: `${positionOf(morocco!, axis) * 100}%` }} />
                      </Show>
                      <For each={props.picked}>
                        {(c, k) => {
                          const value = () => c.values[i] ?? null;
                          return (
                            <Show when={value() !== null}>
                              <button
                                type="button"
                                class={`cmp-mark k${k()}`}
                                style={{ left: `${positionOf(value()!, axis) * 100}%`, "margin-top": `${lane(k())}px` }}
                                aria-label={`${c.name}, ${props.figures[f.id]}: ${formatValue(props.locale, f.unit, value())}`}
                                tabIndex={0}
                                onFocus={(e) => showMark(e.currentTarget, c, i)}
                                onBlur={() => setTip(null)}
                              >
                                <Glyph i={k()} size={14} />
                              </button>
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                    <div class="cmp-ends" aria-hidden="true">
                      <span>{tickLabel(props.locale, f.unit, axis.min)}</span>
                      <span>{tickLabel(props.locale, f.unit, axis.max)}</span>
                    </div>
                  </div>
                );
              }}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}

// Scatter --------------------------------------------------------------------------

const MARGIN = { l: 46, r: 16, t: 30, b: 44 };
/** The arrow beside an axis title: 0.75em of its 12.5px, as everywhere on the site. */
const TITLE_ARROW = 9.4;

/**
 * A figure to put on an axis, picked from the page's own list (the douar form's, in
 * lib/listbox.ts, drawn the same way here): the figures under their topic, the arrows to move,
 * Enter or Space to choose, Escape or Tab to close, a letter to jump.
 */
function FigureSelect(props: { label: string; value: string; onChange: (id: string) => void; figures: Record<string, string>; groups: Record<Group, string> }) {
  const id = createUniqueId();
  const order = GROUPS.flatMap((group) => FIGURES.filter((f) => f.group === group).map((f) => f.id));
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(props.value);
  let wrap!: HTMLDivElement;
  let button!: HTMLButtonElement;
  let list: HTMLUListElement | undefined;
  const optionId = (figure: string) => `${id}-${figure}`;
  const reveal = () => list?.querySelector(`#${CSS.escape(optionId(active()))}`)?.scrollIntoView({ block: "nearest" });
  const show = () => {
    setActive(props.value);
    setOpen(true);
    queueMicrotask(() => {
      list?.focus();
      reveal();
    });
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.focus();
  };
  const choose = (figure: string) => {
    if (figure !== props.value) props.onChange(figure);
    close();
  };
  const move = (to: number) => {
    setActive(order[Math.min(Math.max(to, 0), order.length - 1)]!);
    reveal();
  };
  const onListKey = (event: KeyboardEvent) => {
    const at = order.indexOf(active());
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(at + 1),
      ArrowUp: () => move(at - 1),
      Home: () => move(0),
      End: () => move(order.length - 1),
      Enter: () => choose(active()),
      " ": () => choose(active()),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const run = keys[event.key];
    if (run) {
      if (event.key !== "Tab") event.preventDefault();
      run();
      return;
    }
    if (event.key.length === 1) {
      const letter = event.key.toLowerCase();
      for (let step = 1; step <= order.length; step++) {
        const figure = order[(at + step) % order.length]!;
        if (props.figures[figure]!.toLowerCase().startsWith(letter)) {
          setActive(figure);
          reveal();
          break;
        }
      }
    }
  };
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (open() && !wrap.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    onCleanup(() => document.removeEventListener("pointerdown", outside));
  });
  return (
    <div class="cmp-axis">
      <span id={`${id}-label`}>{props.label}</span>
      <div class="lb" classList={{ open: open() }} ref={wrap}>
        <button
          ref={button}
          type="button"
          class="lb-button"
          id={`${id}-button`}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-labelledby={`${id}-label ${id}-button`}
          onClick={() => (open() ? close() : show())}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
              event.preventDefault();
              show();
            }
          }}
        >
          {props.figures[props.value]}
        </button>
        <Show when={open()}>
          <ul
            ref={list}
            class="lb-list"
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            aria-activedescendant={optionId(active())}
            onKeyDown={onListKey}
          >
            <For each={GROUPS}>
              {(group) => (
                <>
                  <li class="lb-group" role="presentation">
                    {props.groups[group]}
                  </li>
                  <For each={FIGURES.filter((f) => f.group === group)}>
                    {(f) => (
                      <li
                        role="option"
                        id={optionId(f.id)}
                        aria-selected={f.id === props.value}
                        classList={{ active: f.id === active() }}
                        onPointerMove={() => setActive(f.id)}
                        onClick={() => choose(f.id)}
                      >
                        {props.figures[f.id]}
                      </li>
                    )}
                  </For>
                </>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}

function Scatter(props: {
  data: Loaded;
  picked: Commune[];
  state: State;
  update: (change: Partial<State>) => void;
  add: (slug: string) => void;
  locale: Locale;
  copy: Copy;
  figures: Record<string, string>;
  groups: Record<Group, string>;
}) {
  let box!: HTMLDivElement;
  const [width, setWidth] = createSignal(640);
  const [hover, setHover] = createSignal<{ x: number; y: number; i: number } | null>(null);
  onMount(() => {
    setWidth(Math.round(box.clientWidth));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(box);
    onCleanup(() => observer.disconnect());
  });
  const height = () => Math.round(Math.min(560, Math.max(320, width() * (width() < 560 ? 1 : 0.62))));
  const xi = () => FIGURES.findIndex((f) => f.id === props.state.x);
  const yi = () => FIGURES.findIndex((f) => f.id === props.state.y);
  const fx = () => FIGURES[xi()]!;
  const fy = () => FIGURES[yi()]!;
  const ax = () => props.data.axes[xi()]!;
  const ay = () => props.data.axes[yi()]!;
  const px = (v: number) => MARGIN.l + positionOf(v, ax()) * (width() - MARGIN.l - MARGIN.r);
  const py = (v: number) => height() - MARGIN.b - positionOf(v, ay()) * (height() - MARGIN.t - MARGIN.b);
  const points = createMemo(() =>
    props.data.communes.flatMap((c, i) => {
      const a = c.values[xi()];
      const b = c.values[yi()];
      return a == null || b == null ? [] : [{ x: px(a), y: py(b), i }];
    }),
  );
  const xLabels = createMemo(() =>
    fitLabels(
      ticksOf(ax()).map((t) => ({ x: px(t), text: tickLabel(props.locale, fx().unit, t) })),
      width() - 2,
      6.5,
    ),
  );
  const mx = () => props.data.morocco[xi()] ?? null;
  const my = () => props.data.morocco[yi()] ?? null;
  const taken = () => new Set(props.picked.map((c) => c.slug));

  // Labels for the picked communes, nudged down when 2 would sit on each other.
  const marks = createMemo(() => {
    const placed: { c: Commune; k: number; x: number; y: number; ly: number; right: boolean }[] = [];
    props.picked.forEach((c, k) => {
      const a = c.values[xi()];
      const b = c.values[yi()];
      if (a == null || b == null) return;
      const x = px(a);
      const y = py(b);
      const right = x < width() - 140;
      let ly = y;
      for (const other of placed) if (Math.abs(other.ly - ly) < 15 && Math.abs(other.x - x) < 150) ly = other.ly + 15;
      placed.push({ c, k, x, y, ly, right });
    });
    return placed;
  });

  const at = (event: PointerEvent) => {
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    return nearest(points(), event.clientX - rect.left, event.clientY - rect.top, event.pointerType === "touch" ? 22 : 12);
  };
  const tip = (): TipContent | null => {
    const h = hover();
    if (!h) return null;
    const c = props.data.communes[h.i]!;
    return {
      x: h.x,
      y: h.y,
      title: c.name,
      sub: `${c.urban ? props.copy.compareUrban : props.copy.compareRural} · ${c.province}`,
      rows: [
        [props.figures[fx().id] ?? fx().id, formatValue(props.locale, fx().unit, c.values[xi()] ?? null)],
        [props.figures[fy().id] ?? fy().id, formatValue(props.locale, fy().unit, c.values[yi()] ?? null)],
      ],
      note: !taken().has(c.slug) && props.picked.length >= MAX_COMMUNES ? props.copy.compareFull : undefined,
    };
  };

  return (
    <div class="cmp-scatter">
      <div class="cmp-axes">
        <FigureSelect label={props.copy.compareAcross} value={props.state.x} onChange={(x) => props.update(x === props.state.y ? { x, y: props.state.x } : { x })} figures={props.figures} groups={props.groups} />
        <button type="button" class="cmp-swap" onClick={() => props.update({ x: props.state.y, y: props.state.x })}>
          ⇄ {props.copy.compareSwap}
        </button>
        <FigureSelect label={props.copy.compareUp} value={props.state.y} onChange={(y) => props.update(y === props.state.x ? { y, x: props.state.y } : { y })} figures={props.figures} groups={props.groups} />
      </div>
      <div class="cmp-plot" ref={box}>
        <svg
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          role="img"
          aria-label={`${props.figures[fx().id]} / ${props.figures[fy().id]}`}
          onPointerMove={(e) => setHover(at(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const p = at(e as unknown as PointerEvent);
            if (p) props.add(props.data.communes[p.i]!.slug);
          }}
        >
          <g class="cmp-grid">
            <For each={ticksOf(ax())}>{(t) => <line x1={px(t)} x2={px(t)} y1={MARGIN.t} y2={height() - MARGIN.b} />}</For>
            <For each={xLabels()}>
              {(label) => (
                <text x={label.x} y={height() - MARGIN.b + 16} text-anchor={label.anchor}>
                  {label.text}
                </text>
              )}
            </For>
            <For each={ticksOf(ay())}>
              {(t) => (
                <>
                  <line x1={MARGIN.l} x2={width() - MARGIN.r} y1={py(t)} y2={py(t)} />
                  <text x={MARGIN.l - 6} y={py(t)} text-anchor="end" dominant-baseline="central">
                    {tickLabel(props.locale, fy().unit, t)}
                  </text>
                </>
              )}
            </For>
          </g>
          <path class="cmp-arrow" d={ARROW.up} transform={`translate(${MARGIN.l} ${MARGIN.t - 12 - TITLE_ARROW}) scale(${TITLE_ARROW / ARROW_BOX})`} />
          <text class="cmp-title-y" x={MARGIN.l + TITLE_ARROW + 4} y={MARGIN.t - 12}>
            {props.figures[fy().id]}
          </text>
          <text class="cmp-title-x" x={width() - MARGIN.r - TITLE_ARROW - 4} y={height() - 6} text-anchor="end">
            {props.figures[fx().id]}
          </text>
          <path
            class="cmp-arrow"
            d={ARROW.right}
            transform={`translate(${width() - MARGIN.r - TITLE_ARROW} ${height() - 6 - TITLE_ARROW}) scale(${TITLE_ARROW / ARROW_BOX})`}
          />
          <Show when={mx() !== null && my() !== null}>
            <g class="cmp-morocco">
              <line x1={px(mx()!)} x2={px(mx()!)} y1={MARGIN.t} y2={height() - MARGIN.b} />
              <line x1={MARGIN.l} x2={width() - MARGIN.r} y1={py(my()!)} y2={py(my()!)} />
              <text x={px(mx()!) + 4} y={MARGIN.t + 10}>
                {props.copy.compareMorocco}
              </text>
            </g>
          </Show>
          <g class="cmp-dots">
            <For each={points()}>{(p) => <circle cx={p.x} cy={p.y} r={width() < 560 ? 2 : 2.4} />}</For>
          </g>
          <Show when={hover()}>{(h) => <circle class="cmp-hover" cx={h().x} cy={h().y} r={5} />}</Show>
          <For each={marks()}>
            {(m) => (
              <g class={`cmp-picked k${m.k}`}>
                <path d={shapePath(m.k, 6)} transform={`translate(${m.x} ${m.y})`} />
                <text x={m.right ? m.x + 10 : m.x - 10} y={m.ly} text-anchor={m.right ? "start" : "end"} dominant-baseline="central">
                  {m.c.name}
                </text>
              </g>
            )}
          </For>
        </svg>
        <Tip tip={tip()} frame={() => ({ width: width(), height: height() })} />
      </div>
      <p class="cmp-caption">{props.copy.compareDots}</p>
    </div>
  );
}

// Sharing --------------------------------------------------------------------------

function Actions(props: {
  data: Loaded;
  picked: Commune[];
  state: State;
  locale: Locale;
  copy: Copy;
  figures: Record<string, string>;
  groups: Record<Group, string>;
  title: string;
  brand: string;
}) {
  const [copied, setCopied] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  let timer: number | undefined;
  onCleanup(() => clearTimeout(timer));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that won't let the page write to the clipboard still shows the link in its bar.
    }
  };
  const share = () => navigator.share({ title: document.title, url: location.href }).catch(() => {});
  const save = async () => {
    setSaving(true);
    try {
      const { drawCompare } = await import("../lib/compareImage");
      const blob = await drawCompare({
        view: props.state.view,
        locale: props.locale,
        picked: props.picked,
        data: props.data,
        x: props.state.x,
        y: props.state.y,
        figures: props.figures,
        groups: props.groups,
        copy: props.copy,
        title: props.title,
        brand: props.brand,
        // The page's address, not the whole link: a picture can't be clicked, and the page is what to find.
        link: `${location.host}${location.pathname}`,
      });
      const name = `${props.picked.map((c) => c.slug).join("-") || "communes"}.png`;
      const file = new File([blob], name, { type: "image/png" });
      // A phone shares the picture straight to an app; anything else downloads it.
      if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: document.title }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="cmp-actions">
      <button type="button" onClick={copyLink}>
        {copied() ? props.copy.compareCopied : props.copy.compareCopy}
      </button>
      <Show when={canShare}>
        <button type="button" onClick={share}>
          {props.copy.compareShare}
        </button>
      </Show>
      <button type="button" onClick={save} disabled={saving()}>
        {saving() ? props.copy.compareSaving : props.copy.compareSave}
      </button>
    </div>
  );
}

export type { Loaded };
