# Insights pipeline

Proposes, checks and argues against possible reasons for a 2024 census figure that stands
out, then publishes what survives to `data/v1/insights/`. See
[the methods page](https://communes.pages.dev/docs/insights/) for what a figure has to clear
to get there, and [`data/v1/insights/README.md`](../data/v1/insights/README.md) for what the
published files hold.

```sh
INSIGHTS_LIVE=1 pnpm insights                       # runs the pipeline, writes a run file
INSIGHTS_LIVE=1 pnpm insights --limit 5              # just the first 5 findings
INSIGHTS_LIVE=1 pnpm insights --only 01.511.01.0     # just the findings for these codes, comma-separated
INSIGHTS_LIVE=1 pnpm insights --demand               # orders findings by what people open first
pnpm insights:grade                                  # grades a blind sample, yes or no
pnpm insights:regrade                                # regrades some of the same items, for agreement
pnpm insights:score                                  # turns the grades into insights/metrics.json
INSIGHTS_LIVE=1 pnpm insights --publish              # writes data/v1/insights/ if the gate passes
```

It needs Node, pnpm and the `claude` command-line tool signed in: every proposal is a
`claude -p` call, charged to that login's subscription rather than an API bill, and so is the
counter-argument unless `INSIGHTS_FALSIFIER` sends it to Ollama instead. Nothing calls a
model without `INSIGHTS_LIVE=1` set, so a stray `pnpm insights` never spends a real call by
accident. Ollama is optional, and only for running the adversary locally.

## Environment variables

- **`INSIGHTS_LIVE=1`**: required before `pnpm insights` or any transport in `model.ts` will
  call a model at all.
- **`INSIGHTS_FALSIFIER`**: which model argues against a proposal. `"ollama:<model>"` or
  `"claude:<model>"`, split at the first colon; left unset, the adversary is always a
  different model from the proposer, run through the same `claude` command-line tool.
- **`INSIGHTS_DEMAND`**: `"remote"` lets `pnpm insights --demand` read the site's own demand
  log, the last 30 days of page views, and order findings by what people actually open
  before it orders them by score. The same double opt-in the site build uses for
  `ATTENTION=remote`: without `--demand` on the command line, or with this unset, nothing is
  queried and findings are ordered by score alone.
- **`OTEL_EXPORTER_OTLP_ENDPOINT`**: traces a run when it's set. A span opens per stage
  (detect, propose, check, links, falsify, publish) and one per finding under propose and
  falsify, and `claude -p`'s own spans nest under those. Left unset, nothing is traced and no
  span goes anywhere.
- **`OTEL_EXPORTER_OTLP_HEADERS`**: the request headers sent with the trace, as comma-separated
  `key=value` pairs.

Langfuse's free tier works as the collector: set `OTEL_EXPORTER_OTLP_ENDPOINT` to your
project's host with `/api/public/otel` added, and `OTEL_EXPORTER_OTLP_HEADERS` to
`Authorization=Basic <base64 of "public key:secret key">`.

## Where things live

- **`.cache/insights/cache/`**: every model answer, keyed on the prompt, the system prompt,
  the model, the stage's own version and the dataset version. Safe to delete: a re-run just
  asks again for whatever's missing.
- **`.cache/insights/runs/`**: one file per run, named by its `startedAt`, plus
  `latest.json`, the one `pnpm insights:grade` and `--publish` read.
- **`insights/graded.json`**: the owner's blind grades, appended to as `pnpm insights:grade`
  runs and never overwritten. Deleting it starts grading over.
- **`insights/metrics.json`**: what `pnpm insights:score` writes, what the site's methods
  page reads, and what `--publish`'s gate checks a new run against. Its last committed copy
  is the baseline the gate won't let a new run fall behind.
