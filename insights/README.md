# Insights pipeline

Picks a commune's 2024 census figures that stand out, leaves out the ones that can't be
trusted or compared, works out the context beside each, and writes them to
`data/v1/insights/`. No model is called and nothing goes over the network. See
[the methods page](https://communes.pages.dev/docs/insights/) for how a figure is picked,
and [`data/v1/insights/README.md`](../data/v1/insights/README.md) for what the files hold.

```sh
pnpm insights
```

It reads the dataset under `data/v1/` and prints how many figures it detected, how many it left out and why, and how many it
published across how many communes. The same dataset always gives the same files.

## The steps

- **`src/detect.ts`** finds the figures that stand out: extremes, changes since 2014 and gaps
  from a province's figure.
- **`src/filter.ts`** leaves out possible errors in the data, anything that isn't a commune's,
  every figure of a commune `api/src/lib/mismatch.ts` flags, and the shares of men and women.
- **`src/context.ts`** works out each figure's context: the commune's other figures, the
  communes it borders on the same figure, and the same figure in 2014 beside Morocco's.
- **`src/run.ts`** writes the line for each figure, holds back any whose words break the
  policy in `src/safety.ts`, and writes the files.

## Environment variables

- **`INSIGHTS_LOCAL`**: a folder for local settings. A `terms.txt` there (one term per line)
  adds terms that hold back any figure whose line uses one. Unset, a run warns and checks no
  extra terms.

## The pilot

An earlier design had a language model propose possible reasons for each figure. The 2026
pilot that chose its models stays re-runnable, with its study in
[`pilot/`](pilot/README.md) and its code in `src/pilot/`. It still uses the model transports
in `src/model.ts`, the proposing and checking in `src/propose.ts`, `src/falsify.ts`,
`src/links.ts` and `src/vocabulary.ts`, and the choice of models in `insights/setup.json`.
The pilot's commands call a model only with `INSIGHTS_LIVE=1` set; `pnpm insights` never
does.
