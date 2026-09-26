# Preregistration: choosing the insights pipeline's models

The insights pipeline proposes reasons for a 2024 census figure that stands out, then argues
against each one before anything gets published. A full run costs thousands of calls to a
language model, and which model proposes, which model argues, and how hard each one thinks
had so far been picked by argument alone. This pilot settles those choices on a small, fixed
sample first, with the rules for reading its results fixed in advance. This file went into
git before a single pilot call ran, so its own commit history is the record of that.

## Setups

Stage A tries 4 proposer setups on the same findings, 5 samples each:

| Setup | Model | Effort |
| --- | --- | --- |
| P1 | Haiku 4.5 | none |
| P2 | Sonnet 5 | medium |
| P3 | Sonnet 5 | high |
| P4 | Opus 5.5 | medium |

P1 runs with no effort setting at all: Haiku 4.5 doesn't take one.

Stage B tries 5 adversary runs against one shared pool of candidates:

| Run | Model | Effort |
| --- | --- | --- |
| A1 | Opus 5.5 | medium |
| A2 | Opus 5.5 | medium, a second run of the same setup |
| A3 | Opus 5.5 | high |
| A4 | Sonnet 5 | high |
| A5 | Gemini 3.8 Flash | its own default |

A2 repeats A1's exact setup as a fresh run in its own right, with a run label that keeps its
cache entry apart from A1's. Together, they measure how much 2 runs of the same model can
disagree with each other: the noise floor every other comparison gets read against.

## Samples

16 findings feed stage A: 6 extremes, 5 changes and 5 gaps, drawn with a fixed seed once
artefacts are excluded. A commune and a province both turn up among them.

Stage B works from a pool of up to 30 passing candidates per proposer setup, up to 120 in
all. A setup with fewer than 30 candidates that passed their data test contributes what it
has, and the write-up says how many that was. Every candidate keeps a record of which
proposer setup put it forward.

## Measures

Every per-finding measure gets a 95% bootstrap interval, resampling the findings 2,000 times
with a fixed seed. The pilot is built to catch large differences, roughly 25 points or more,
and the write-up says so wherever a result turns on one.

For each proposer setup: how many answers were usable; how many data tests passed, were
refused or came back missing; how many distinct reasons turned up per finding; how spread
out the 5 samples' reasons were; how many link tests got proposed and judged consistent; how
often the safety check dropped an answer; tokens and seconds per call; and the owner's blind
yes rate on 15 rated reasons.

For each adversary run: its break rate; how many counter-tests came back unusable; agreement
with every other run, measured by Cohen's kappa, with the A1-A2 pair standing in for the
noise floor; how its break rate on its own model family's candidates compares with its break
rate on everyone else's; tokens and seconds per call; and, on every candidate where the runs
disagree, the owner's own blind judgement of whether the reason holds up and whether the
counter-test actually breaks it.

Across the 5 proposer samples: how many of the reasons rated good at 5 samples still turn up
when the same analysis runs on just the first sample, the first 2, the first 3 or the first
4.

On the pool: how often each adversary's safety check refuses a candidate, checked against a
private backstop of terms in both directions, a term matched while the check passed it, or
the check refusing with no term matched. This is reported by count only; a term or a
candidate's own words are never quoted.

## Decision rules

These rules are fixed now, before any pilot call, so nothing about reading the results gets
decided after the fact.

1. **Proposer.** Pick the cheapest setup, priced by tokens at each model's list price, whose
   blind yes rate sits within 10 points of the best one. A tie goes to the cheaper setup.
2. **Adversary effort.** Medium effort is enough when A3's kappa with A1 sits within 0.05 of
   A1 and A2's own kappa, the noise floor. Otherwise, high effort is worth the extra cost
   only if the owner's own judgement finds its extra breaks were right at least 2 times in
   3; when it doesn't clear that bar, medium effort still wins.
3. **Adversary model.** A4 or A5 takes over from Opus once its kappa with A1 sits within
   0.05 of the noise floor and it gets the disagreements right at least as often as A1 does.
   A5 can qualify this way and still be too slow: at one call at a time, its seconds per
   call times 2,400 calls would need to fit inside 48 hours, and if it doesn't, the full run
   goes to whichever setup qualifies next, with the write-up saying so.
4. **Self-preference.** An adversary that breaks its own model family's reasons at least 15
   points less often than it breaks everyone else's doesn't get paired with that family in
   the full run.
5. **Samples.** Use the smallest sample count from 1 to 5 that already finds at least 90% of
   the reasons that 5 samples find good.
6. **Attacking only the shown reasons.** Turn this on if at least 80% of all the breaks land
   on the top 3 reasons by support, the ones a page would actually show.

The setup these rules choose gets written to a committed file the full run reads; none of
this gets decided by hand once the results are in.

The pilot's findings, its pool and its rating draws all come from one fixed seed: **20260925**.
