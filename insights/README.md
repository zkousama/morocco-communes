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
pnpm insights --publish                              # writes data/v1/insights/ if the gate passes
```

It needs Node, pnpm and the `claude` command-line tool signed in: every proposal is a
`claude -p` call, charged to that login's subscription rather than an API bill, and the
counter-argument is too unless `insights/setup.json` sends it to Ollama or Gemini instead.
Nothing calls a model without `INSIGHTS_LIVE=1` set, so a stray `pnpm insights` never spends
a real call by accident. Ollama and Gemini are optional, and only for running the adversary
under a different model: Ollama locally, Gemini on its free tier with a `GEMINI_API_KEY` in
`keys.env` under `INSIGHTS_LOCAL`.

Each `claude -p` call runs from the system's temp directory, apart from this repository and
your own setup, with local settings only and the flags `--strict-mcp-config` (with no MCP
config given), `--tools ""` and `--no-session-persistence`. `ANTHROPIC_API_KEY` is taken
out of its environment, so it answers on the signed-in subscription even when a key is set
in your shell.

## Environment variables

- **`INSIGHTS_LIVE=1`**: required before `pnpm insights` or any transport in `model.ts` will
  call a model at all.
- **`INSIGHTS_DEMAND`**: `"remote"` lets `pnpm insights --demand` read the site's own demand
  log, the last 30 days of page views, and order findings by what people actually open
  before it orders them by score. The same double opt-in the site build uses for
  `ATTENTION=remote`: without `--demand` on the command line, or with this unset, nothing is
  queried and findings are ordered by score alone.
- **`INSIGHTS_LOCAL`**: a folder for local settings. A `terms.txt` there (one term per line)
  adds terms that drop any reason naming them; a `keys.env` there (`NAME=value` lines) holds
  keys for optional transports. Unset, a live run warns and checks no extra terms.
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

- **`insights/setup.json`**: which model plays proposer and adversary, at what effort, how
  many samples the proposer asks and whether the adversary sees only the reasons a page
  would show. The pilot chooses these by measurement and commits the file; `pnpm insights`
  only ever reads it, and refuses to start on one that doesn't parse.
- **`.cache/insights/cache/`**: every model answer, keyed on the prompt, the system prompt,
  the model, the stage's own version and the dataset version. Safe to delete: a re-run just
  asks again for whatever's missing.
- **`.cache/insights/runs/`**: one file per run, named by its `startedAt`, plus
  `latest.json`, the one `pnpm insights:grade`, `pnpm insights:score` and `--publish` read.
  A run file's `runId` is a short hash of when it started, both prompts, the stage versions,
  the dataset version and the models, and `partial` is true when `--limit` or `--only` left
  findings out. A run also stops early when 3 proposer or adversary calls fail in a row, as
  they do once a subscription's limit is reached. Its file is still written, with `partial`
  true and `stopped` saying why.
- **`insights/graded.json`**: the owner's blind grades, appended to as `pnpm insights:grade`
  runs and never overwritten. Each grade keeps the `runId` it was drawn from, and grading,
  scoring and publishing only read the latest run's, so a new run needs its own graded set,
  whatever changed to make it. Deleting the file starts grading over.
- **`insights/metrics.json`**: what `pnpm insights:score` writes for the latest run, with its
  `runId`. `--publish` refuses it for any other run, and refuses a partial run outright.
- **`insights/published.json`**: written by every publish that passes: the run it published
  and the metrics it passed with. It's the baseline the gate won't let a new run fall
  behind, and the numbers the site's methods page quotes, so it's committed with the files
  under `data/v1/insights/`.

## What `insights/metrics.json` holds

- **`runId`**: the run whose grades these are.
- **`measuredAt`**: when `pnpm insights:score` wrote the file.
- **`published`**: the published side's yes answers, `yes`, out of its yes and no answers,
  `graded`, with the 95% Wilson interval's `low` and `high`, and `lowOneSided`, the one-sided
  lower bound, kept for reading; the gate works it out again from the counts.
- **`rejectedButSound`**: rejected hypotheses graded yes, `count`, and `byStage`, where each
  one stopped.
- **`agreement`**: Cohen's `kappa` between the first grades and the regrades, over `n` pairs,
  or `null` before any regrading.
- **`planted`**: how often a corrupted premise test stops passing. Every published hypothesis
  graded yes has its premise's data test corrupted each way that fits it, and each corrupted
  test is run again on its own: `total` counts them, `caught` counts the ones that stopped
  passing, and `byKind` splits both by the kind of corruption. The adversary and the link
  test play no part in it. The gate refuses a run whose rate is lower than the last
  published run's.
