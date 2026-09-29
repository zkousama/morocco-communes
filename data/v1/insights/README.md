# Insights, v2

A commune's 2024 census figures that stand out, each with its context worked out from the
census. No language model writes or judges any of it. See
[the methods page](https://communes.pages.dev/docs/insights/) for how a figure is picked and
what's left out.

## What's in it

A figure stands out when a commune is at the extreme end of a measure, when its figure moved
far more or far less than other communes' since 2014, or when it's far from its province's
figure. Some figures that stand out are left out:

- a possible error in the data, such as a slow-moving figure that swings in a place whose
  population barely moved;
- a commune with any figure the two censuses disagree on, the same ones `api/src/lib/mismatch.ts`
  flags, since whatever set that figure apart may have moved its others too;
- the shares of men and women, since several southern communes count special populations;
- getting to work by tram, train, bus, taxi or an employer's transport, since those
  services only some places have;
- an economy figure for a commune with fewer than 100 businesses, or a housing figure for
  one with fewer than 100 urban dwellings, since a handful of them can swing a share;
- anything whose line uses a term the safety policy holds back.

Beside each figure that's left is its context, as numbers: the commune's other figures here,
the communes it borders on the same figure, and the same figure in 2014 beside Morocco's.

## Files

- `communes/<code>.json` holds one file per commune with at least one figure published.
  Most communes have none.
- `index.json` lists every commune with a file: its code, its level and how many figures it
  holds.

`pnpm insights` writes both from the rest of `data/v1/`, with no model and no network call.
The same dataset always gives the same files, so a re-run with nothing changed leaves no diff.

## Reading a commune's file

- `code`, `level` and `name` are the commune's own, the same as `../attributes/`.
- `datasetVersion` is the dataset version the figures were read from.
- `findings` holds up to 3 figures, the one that stands out most first. Each has:
  - `id`, which stays the same across runs for the same commune, measure and kind;
  - `kind`: `extreme`, `change` or `gap`;
  - `measure`, the field's path, the same one the API sorts communes by;
  - `value`, the 2024 figure, or for a change the points it moved since 2014;
  - `reference`, what it stands out from: the mean across communes for an extreme, the
    province's figure for a gap, and 0 for a change;
  - `score`, how far it stands out, in standard deviations;
  - `direction`, `high` or `low`;
  - `sampled`, true when the figure is a census figure in a commune of 2,000 households or
    more, where the long questionnaire went to a sample of households. Economy and housing
    figures are full counts, so `sampled` is false for them. Under 2,000 households the
    questionnaire went to every household, and `sampled` is false;
  - `line`, the sentence stating the figure, in English and French;
  - `breakdown`, the parts the figure is made of where the dataset has them, or `null`;
  - `context`, set out below.

## Reading the context

- `others` lists the commune's other figures in the same file, each by `id`, `kind` and
  `measure`.
- `neighbours` is `null` when none of the communes it borders can be compared. Otherwise:
  - `bordering` is how many communes it borders, from `../geometry/adjacency.json`;
  - `compared` is how many of those have the figure to compare. A neighbour of fewer than
    2,000 people is left out, and so is one with any figure the two censuses disagree on. For a
    change, a neighbour matched to 2014 through the crosswalk is left out too;
  - `median` is the median of the figure across the compared neighbours, or of their change
    for a change;
  - `furthest` is the compared neighbour whose figure is furthest from this commune's, with
    its `code`, `name` and `value`.
- `since2014` is `null` where the 2014 census didn't ask the figure the same way, or where the
  commune was matched to 2014 through the crosswalk. Otherwise `then` and `now` are the
  commune's 2014 and 2024 figures, and `morocco` holds the country's.

## Licence

The figures are HCP's, on the same CC BY 4.0 terms as the rest of `data/v1/`: credit the
Haut-Commissariat au Plan, RGPH 2024, and say what was changed. The lines are fixed sentences
this repository's own pipeline fills in.
