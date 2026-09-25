# Insights, v1

Possible reasons for the 2024 census figures that stand out, checked and argued over before
they're published. See [the methods page](https://communes.pages.dev/docs/insights/) for how
a figure earns a place here.

## What's in it

A finding is one figure that stands out: a commune at the extreme end of a measure, a unit
whose figure moved far more, or far less, than others of its level since 2014, a commune or
province far from its own province's or région's figure, or a slow-moving figure whose swing
looks more like an error in the data than a real change.

A finding can carry a few hypotheses for why. A hypothesis has a claim, the possible reason
in a few words; a premise, a fact about the place; and a link, why that fact would explain
the figure. The premise is always checked: a data test reads 2 or more figures from the
census and comes out true or false, and only a premise whose test passed makes it here. The
link is different, since it's a claim about cause that the census alone can't settle. Where a
link test fits, it checks whether the premise goes with the outcome across every place of
that level, more closely than 3 unrelated measures do, and the link is shown as tested for
consistency. Otherwise it's shown as proposed only, with no test behind it.

Every claim, premise and link here was written by a language model, then checked, argued
against by a second model trying to break it, and, where it fits, tested across places, all
by this repository's own build. Nothing here is asserted as HCP's own finding, and a checked
premise or a consistent link doesn't make a hypothesis true, only one that survived the
checks this build runs.

## Files

- `regions/<code>.json`, `provinces/<code>.json`, `communes/<code>.json` and
  `arrondissements/<code>.json` hold one file per unit that has at least one finding worth
  publishing: a possible data artefact, or a finding with at least one hypothesis that
  survived every check. A unit whose findings all failed those checks has no file.
- `index.json` lists every unit with a file: its code, its level and how many findings it
  holds.

## Reading a unit's file

- `code`, `level` and `name` are the unit's own, the same as `../attributes/`.
- `datasetVersion` is the dataset version the checks read, and `checkedAt` is the date the
  pipeline last checked this unit, `YYYY-MM-DD`.
- `findings` is a list. Each finding has an `id`; a `kind`, one of `extreme`, `change`,
  `gap` or `artefact`; a `measure`, the field's path, the same one the API sorts communes by;
  a `line`, the sentence stating the figure, in English and French; a `breakdown`, the parts
  the figure is made of where the dataset has them, or `null`; and `hypotheses`, up to 3 of
  the ones that survived, the highest-support first. An artefact finding has no hypotheses:
  it's flagged rather than explained.

## Reading a hypothesis

- `claim`, `premise` and `link` are each given in English and French.
- `evidence` is the data test that checked the premise: `check` is the test itself, in the
  same vocabulary the methods page sets out, and `numbers` are the exact figures it read, so
  its result can be checked without running anything again.
- `linkTest` is `null` where no link test fits, or where one wasn't proposed. Otherwise it's
  the test that ran, its `verdict` (`consistent` or `refused`, since a hypothesis with a
  `not consistent` verdict doesn't survive), its `p`-value, corrected across every link test
  in the same run, and its `effect`, the size and direction of what the test found.
- `support` counts how many of the model's 5 independent tries proposed this same premise, a
  plain count rather than a probability.
- `stage` and `reason` are carried over from the run that produced this file. Every
  hypothesis here made it to `stage: "published"`, so `reason` is always `null`; they're kept
  so the field means the same thing here as it does in the run itself.

## Licence

The figures a data test reads are HCP's, on the same CC BY 4.0 terms as the rest of
`data/v1/`: credit the Haut-Commissariat au Plan, RGPH 2024, and say what was changed. The
claims, premises and links are text this repository's own pipeline wrote and checked.
