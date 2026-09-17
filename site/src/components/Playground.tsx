import { createSignal, For, Show } from "solid-js";

type Copy = Record<string, string>;

interface Props {
  copy: Copy;
}

interface Result {
  url: string;
  status: number;
  tier: string;
  body: string;
}

type Mode = "search" | "near" | "lookup";

/**
 * Runs against the same origin, so it exercises whatever it is served beside — wrangler
 * dev locally, the real Worker in production — rather than a mock. The request URL is on
 * screen because the URL is the documentation.
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
        tier: response.headers.get("x-api-tier") ?? "—",
        body,
      });
    } catch {
      setFailed(true);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Mode; label: string; hint: string }[] = [
    { id: "search", label: props.copy.searchTab!, hint: props.copy.searchHint! },
    { id: "near", label: props.copy.nearTab!, hint: props.copy.nearHint! },
    { id: "lookup", label: props.copy.lookupTab!, hint: props.copy.lookupHint! },
  ];

  const examples = () =>
    mode() === "search"
      ? ["Fez", "طنجة", "Shefshaouen", "Port Lyautey"]
      : mode() === "lookup"
        ? ["tanger", "01.511.01.0", "001511010", "1511010"]
        : [];

  return (
    <div class="pg">
      <div class="pg-tabs" role="tablist">
        <For each={tabs}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={mode() === tab.id}
              onClick={() => {
                setMode(tab.id);
                setResult(null);
                setFailed(false);
              }}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      <p class="pg-hint">{tabs.find((tab) => tab.id === mode())!.hint}</p>

      <div class="pg-controls">
        <Show when={mode() === "search"}>
          <label>
            <span>{props.copy.fieldQuery}</span>
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
            <span>{props.copy.fieldRadius}</span>
            <input value={radius()} onInput={(e) => setRadius(e.currentTarget.value)} inputmode="numeric" dir="ltr" />
          </label>
        </Show>

        <Show when={mode() === "lookup"}>
          <label>
            <span>{props.copy.fieldIdentifier}</span>
            <input value={identifier()} onInput={(e) => setIdentifier(e.currentTarget.value)} dir="ltr" />
          </label>
        </Show>

        <button type="button" class="pg-run" onClick={run} disabled={busy()}>
          {busy() ? props.copy.running : props.copy.run}
        </button>
      </div>

      <Show when={examples().length > 0}>
        <div class="pg-examples">
          <For each={examples()}>
            {(example) => (
              <button
                type="button"
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

      <div class="pg-wire">
        <p class="pg-req">
          <span>{props.copy.request}</span>
          <code>GET {url()}</code>
        </p>

        <Show
          when={result()}
          fallback={<p class="pg-idle">{failed() ? props.copy.failed : props.copy.emptyState}</p>}
        >
          {(r) => (
            <>
              <p class="pg-res">
                <span>{props.copy.tier}</span>
                <code>
                  {r().status} · {r().tier}
                </code>
              </p>
              <pre>{r().body}</pre>
            </>
          )}
        </Show>
      </div>

      <style>{`
        .pg { margin-top: 1.75rem; }

        .pg-tabs {
          display: flex;
          gap: 1.4rem;
          border-bottom: 1px solid var(--rule);
        }
        .pg-tabs button {
          font: inherit;
          font-size: var(--t-sm);
          color: var(--quiet);
          background: none;
          border: 0;
          border-bottom: 2px solid transparent;
          padding: 0 0 0.6rem;
          margin-bottom: -1px;
          cursor: pointer;
        }
        .pg-tabs button:hover { color: var(--ink); }
        .pg-tabs button[aria-selected="true"] {
          color: var(--ink);
          border-bottom-color: var(--brass);
        }

        .pg-hint {
          color: var(--quiet);
          font-size: var(--t-sm);
          max-width: 60ch;
          margin: 1rem 0 1.4rem;
        }

        .pg-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 0.9rem 1.1rem;
          align-items: end;
          max-width: 38rem;
        }
        .pg-controls label {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          flex: 1 1 8rem;
          min-width: 0;
        }
        .pg-controls span {
          font-size: var(--t-xs);
          color: var(--quiet);
        }
        .pg-controls input {
          font: inherit;
          font-size: var(--t-sm);
          color: var(--ink);
          background: transparent;
          border: 0;
          border-bottom: 1px solid var(--ink);
          padding: 0.3rem 0;
          min-width: 0;
          border-radius: 0;
        }
        .pg-controls input:focus { outline: 0; border-bottom-color: var(--brass); border-bottom-width: 2px; }
        .pg-controls input:focus-visible { outline: 0; }

        .pg-run {
          font: inherit;
          font-size: var(--t-sm);
          color: var(--paper);
          background: var(--ink);
          border: 1px solid var(--ink);
          border-radius: 2px;
          padding: 0.42rem 1.5rem;
          cursor: pointer;
        }
        .pg-run:hover:not(:disabled) { background: var(--brass); border-color: var(--brass); }
        .pg-run:disabled { opacity: 0.55; cursor: progress; }

        .pg-examples {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem 0.9rem;
          margin-top: 1.1rem;
        }
        .pg-examples button {
          font-family: var(--mono);
          font-size: var(--t-xs);
          color: var(--quiet);
          background: none;
          border: 0;
          padding: 0;
          cursor: pointer;
          text-decoration: underline;
          text-decoration-color: var(--rule);
          text-underline-offset: 0.25em;
        }
        .pg-examples button:hover { color: var(--brass); text-decoration-color: var(--brass); }

        .pg-wire { margin-top: 1.75rem; }

        .pg-req, .pg-res {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem 0.8rem;
          align-items: baseline;
          margin: 0 0 0.6rem;
          max-width: none;
        }
        .pg-req > span, .pg-res > span {
          font-size: var(--t-xs);
          color: var(--quiet);
          flex: 0 0 auto;
        }
        .pg-req code, .pg-res code {
          font-size: var(--t-xs);
          word-break: break-all;
          direction: ltr;
          color: var(--ink);
        }
        .pg-res { margin-top: 1.1rem; }
        .pg-res code { color: var(--brass); }

        .pg-idle {
          color: var(--quiet);
          font-size: var(--t-sm);
          margin: 0;
          padding: 1.1rem 0 0;
          border-top: 1px solid var(--rule);
        }

        .pg pre {
          margin: 0;
          padding: 1.1rem 1.25rem;
          background: var(--canvas);
          color: #b9cfc5;
          border-radius: 3px;
          overflow: auto;
          max-height: 21rem;
          font-family: var(--mono);
          font-size: var(--t-xs);
          line-height: 1.7;
          direction: ltr;
          text-align: left;
          tab-size: 2;
        }
      `}</style>
    </div>
  );
}
