import { createSignal, For, Show } from "solid-js";

type Copy = Record<string, string>;

interface Props {
  copy: Copy;
  rtl: boolean;
}

interface Result {
  url: string;
  status: number;
  tier: string;
  body: string;
}

type Mode = "search" | "near" | "lookup";

/**
 * Runs against the same origin, so the playground exercises whatever it is deployed
 * beside — `wrangler dev` locally, the real Worker in production — rather than a mock.
 * The request URL is shown because the URL is the documentation.
 */
export default function Playground(props: Props) {
  const [mode, setMode] = createSignal<Mode>("search");
  const [query, setQuery] = createSignal("Fez");
  const [lat, setLat] = createSignal("33.5731");
  const [lng, setLng] = createSignal("-7.5898");
  const [radius, setRadius] = createSignal("15");
  const [identifier, setIdentifier] = createSignal("tanger");
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<Result | null>(null);
  const [failed, setFailed] = createSignal(false);

  const url = () => {
    switch (mode()) {
      case "search":
        return `/api/search?q=${encodeURIComponent(query())}&limit=5`;
      case "near":
        return `/api/communes/near?lat=${encodeURIComponent(lat())}&lng=${encodeURIComponent(lng())}&radius=${encodeURIComponent(radius())}&limit=5`;
      case "lookup":
        return `/api/communes/${encodeURIComponent(identifier())}`;
    }
  };

  const run = async () => {
    setBusy(true);
    setFailed(false);
    const target = url();
    try {
      const response = await fetch(target);
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* a non-JSON body is worth showing as it came */
      }
      setResult({
        url: target,
        status: response.status,
        tier: response.headers.get("x-api-tier") ?? "pre-rendered",
        body,
      });
    } catch {
      setFailed(true);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const modes: { id: Mode; label: string; hint: string }[] = [
    { id: "search", label: props.copy.search!, hint: props.copy.searchBody! },
    { id: "near", label: props.copy.near!, hint: props.copy.nearBody! },
    { id: "lookup", label: props.copy.lookup!, hint: props.copy.lookupBody! },
  ];

  const examples = () =>
    mode() === "search"
      ? ["Fez", "طنجة", "Shefshaouen", "Port Lyautey", "Ait Kamra"]
      : mode() === "lookup"
        ? ["tanger", "01.511.01.0", "001511010", "1511010"]
        : [];

  return (
    <div class="pg">
      <div class="pg-tabs" role="tablist">
        <For each={modes}>
          {(m) => (
            <button
              role="tab"
              aria-selected={mode() === m.id}
              class={mode() === m.id ? "pg-tab on" : "pg-tab"}
              onClick={() => {
                setMode(m.id);
                setResult(null);
                setFailed(false);
              }}
            >
              {m.label}
            </button>
          )}
        </For>
      </div>

      <p class="pg-hint">{modes.find((m) => m.id === mode())!.hint}</p>

      <div class="pg-fields">
        <Show when={mode() === "search"}>
          <label>
            <span>{props.copy.query}</span>
            <input value={query()} onInput={(e) => setQuery(e.currentTarget.value)} dir="auto" />
          </label>
        </Show>

        <Show when={mode() === "near"}>
          <label>
            <span>lat</span>
            <input value={lat()} onInput={(e) => setLat(e.currentTarget.value)} inputmode="decimal" dir="ltr" />
          </label>
          <label>
            <span>lng</span>
            <input value={lng()} onInput={(e) => setLng(e.currentTarget.value)} inputmode="decimal" dir="ltr" />
          </label>
          <label>
            <span>{props.copy.radius}</span>
            <input value={radius()} onInput={(e) => setRadius(e.currentTarget.value)} inputmode="numeric" dir="ltr" />
          </label>
        </Show>

        <Show when={mode() === "lookup"}>
          <label>
            <span>{props.copy.identifier}</span>
            <input value={identifier()} onInput={(e) => setIdentifier(e.currentTarget.value)} dir="ltr" />
          </label>
        </Show>

        <button class="pg-run" onClick={run} disabled={busy()}>
          {busy() ? props.copy.running : props.copy.run}
        </button>
      </div>

      <Show when={examples().length > 0}>
        <div class="pg-examples">
          <For each={examples()}>
            {(example) => (
              <button
                class="pg-chip"
                onClick={() => {
                  if (mode() === "search") setQuery(example);
                  else setIdentifier(example);
                  void run();
                }}
              >
                {example}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="pg-url">
        <span class="pg-label">{props.copy.request}</span>
        <code>GET {url()}</code>
      </div>

      <Show
        when={result()}
        fallback={
          <pre class="pg-out muted">{failed() ? props.copy.failed : props.copy.empty}</pre>
        }
      >
        {(r) => (
          <>
            <div class="pg-meta">
              <span class={r().status < 400 ? "pg-badge ok" : "pg-badge bad"}>{r().status}</span>
              <span class="pg-label">{props.copy.tier}</span>
              <span class="pg-badge tier">{r().tier}</span>
            </div>
            <pre class="pg-out">{r().body}</pre>
          </>
        )}
      </Show>

      <style>{`
        .pg {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 1.1rem;
        }
        .pg-tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; }
        .pg-tab {
          font: inherit;
          font-size: 0.9rem;
          padding: 0.4rem 0.9rem;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
        }
        .pg-tab:hover { color: var(--ink); }
        .pg-tab.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
        .pg-hint { color: var(--muted); font-size: 0.9rem; margin: 0.9rem 0 1rem; max-width: 62ch; }
        .pg-fields { display: flex; flex-wrap: wrap; gap: 0.7rem; align-items: flex-end; }
        .pg-fields label { display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 9rem; }
        .pg-fields span { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
        .pg-fields input {
          font: inherit;
          padding: 0.5rem 0.7rem;
          border-radius: 10px;
          border: 1px solid var(--line);
          background: var(--bg);
          color: var(--ink);
          min-width: 0;
        }
        .pg-fields input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .pg-run {
          font: inherit;
          font-weight: 560;
          padding: 0.52rem 1.4rem;
          border-radius: 10px;
          border: 1px solid var(--accent);
          background: var(--accent);
          color: #fff;
          cursor: pointer;
        }
        .pg-run:disabled { opacity: 0.6; cursor: progress; }
        .pg-examples { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.9rem; }
        .pg-chip {
          font: inherit;
          font-size: 0.8rem;
          font-family: var(--mono);
          padding: 0.25rem 0.6rem;
          border-radius: 8px;
          border: 1px dashed var(--line);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
        }
        .pg-chip:hover { color: var(--accent); border-color: var(--accent); }
        .pg-url { margin: 1.1rem 0 0.6rem; display: flex; flex-direction: column; gap: 0.3rem; }
        .pg-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); }
        .pg-url code { font-size: 0.82rem; word-break: break-all; direction: ltr; text-align: left; }
        .pg-meta { display: flex; align-items: center; gap: 0.5rem; margin: 0.9rem 0 0.4rem; }
        .pg-badge {
          font-family: var(--mono);
          font-size: 0.75rem;
          padding: 0.1rem 0.5rem;
          border-radius: 6px;
          border: 1px solid var(--line);
        }
        .pg-badge.ok { color: #2f7a4f; border-color: #2f7a4f44; background: #2f7a4f14; }
        .pg-badge.bad { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
        .pg-badge.tier { color: var(--muted); }
        .pg-out { max-height: 22rem; }
        .pg-out.muted { color: var(--muted); }
      `}</style>
    </div>
  );
}
