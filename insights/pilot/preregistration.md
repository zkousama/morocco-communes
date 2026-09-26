# Preregistration: choosing the insights pipeline's models

The insights pipeline proposes reasons for a 2024 census figure that stands out, then argues
against each one before anything gets published. A full run costs thousands of calls to a
language model, and which model proposes, how hard the adversary that argues back thinks,
which model plays that adversary, how many samples the proposer asks for, and whether the
adversary attacks only the reasons a page would show have so far been picked by argument
alone. This pilot settles all of that on a small, fixed sample first, with the rules for
reading its results fixed in advance. This file went into git before a single pilot call
ran, so its own commit history is the record of that.

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
| A5 | Gemini 3.8 Flash | none |

A2 repeats A1's exact setup as a fresh run in its own right, with a run label that keeps its
cache entry apart from A1's. Together, they measure how much running the same model twice
can disagree with itself: the noise floor every other comparison gets read against.

## Samples

16 findings feed stage A: 6 extremes, 5 changes and 5 gaps, drawn with a fixed seed once
artefacts are excluded. A commune and a province both turn up among them.

Stage B works from a pool of up to 30 passing candidates per proposer setup, up to 120 in
all. A setup with fewer than 30 candidates that passed their data test contributes what it
has, and the write-up says how many that was. Every candidate keeps a record of which
proposer setup put it forward.

## Sampled findings

The seed fixes exactly which findings these are. Here they are, so a later change to
detection can't quietly change the sample it draws from:

| Kind | Code | Measure | Finding id |
| --- | --- | --- | --- |
| extreme | `04.481.01.03` | `housing.ageByType.apartment50Plus` | `ba86c6c8a9a3` |
| extreme | `01.573.01.07` | `householdWaste.other` | `c47f25f4814d` |
| extreme | `03.171.07.05` | `economy.share.size.50+` | `ffd4fa0387be` |
| extreme | `01.227.05.09` | `economy.perBusiness.jobs` | `793fabdafca5` |
| extreme | `03.531.05.13` | `economy.share.founded.1981-1990` | `81bfb4a7bc1a` |
| extreme | `07.351.03.05` | `housing.ageByType.sound50Plus` | `29543016d59a` |
| change | `12.391.05.01` | `dwellingType.basicOrSlum` | `20c7ec12506f` |
| change | `01.051.09.23` | `localLanguages.tarifit` | `99d8e9ff36ef` |
| change | `07.041.07.01` | `dwellingType.other` | `03c343541210` |
| change | `11.537.05.01` | `localLanguages.hassania` | `cfbe9a73dc98` |
| change | `12.066` | `localLanguages.hassania` | `d666cf2f0c0d` |
| gap | `07.191.01.07` | `economy.share.founded.before1956` | `27b2a16b21d2` |
| gap | `07.211.01.05` | `localLanguages.tarifit` | `d996aa2daca5` |
| gap | `03.531.05.13` | `economy.share.founded.before1956` | `bd4536c9634e` |
| gap | `09.541.07.05` | `employmentStatus.familyWorker` | `894866a14b36` |
| gap | `09.541.01.01` | `economy.per1000.jobs` | `c32a65fd8146` |

## Measures

Every per-finding measure gets a 95% bootstrap interval, resampling the findings 2,000 times
with a fixed seed. The pilot is built to catch only large differences; "What this pilot can
tell apart" below says how large.

For each proposer setup: how many answers were usable; how many data tests passed, were
refused (tautology, unknown field) or came back missing; how many distinct reasons turned up
per finding; how spread out the 5 samples' reasons were, measured as semantic entropy; how
many link tests got proposed and judged consistent; how many reasons the safety check
dropped, by category; tokens and seconds per call; and the owner's blind yes rate on 15
rated reasons.

For each adversary run: its break rate; how many counter-tests came back unusable; agreement
with every other run, measured by Cohen's kappa, with the A1-A2 pair standing in for the
noise floor; how its break rate on its own model family's candidates compares with its break
rate on everyone else's; tokens and seconds per call; and, on the disagreements rated below,
the owner's own blind judgement of whether the reason holds up and whether the counter-test
actually breaks it.

Across the 5 proposer samples: how many of the reasons rated good at 5 samples still turn up
when the same analysis runs on just the first sample, the first 2 samples, the first 3
samples or the first 4 samples.

On the pool: how often each adversary's safety check refuses a candidate, and how that lines
up with a private backstop of terms in both directions: a term matched while the check
passed it, or the check refusing with no term matched. The private terms stay on as a
backstop in the full run whatever the pilot decides; a policy miss is listed in the write-up
by candidate id and category, a term or a candidate's own words never quoted.

## Decision rules

These rules are fixed before any pilot call. Where a rule below calls for the owner's own
judgement, that call was part of the rule from the start. Every rule compares point
estimates; the write-up reports each measure's interval beside it, but the interval itself
never moves a decision. A run counts as right on a disagreement when it broke a reason the
owner judged unsound, or passed one the owner judged sound; a skipped judgement counts for
neither.

1. **Proposer.** Pick the cheapest setup, priced by tokens at each model's list price, whose
   blind yes rate sits within 10 points of the best one. A tie goes to the cheaper setup.
2. **Adversary effort.** Medium effort is enough when A3's kappa with A1 differs from A1 and
   A2's own kappa, the noise floor, by 0.05 or less. Otherwise, high effort is worth the
   extra cost only if the owner's own judgement finds A3's extra breaks, the candidates A3
   broke and A1 passed, were right at least 2 times in 3; when it doesn't clear that bar,
   medium effort still wins.
3. **Adversary model.** A4 and A5 each qualify to replace Opus if their kappa with A1
   differs from the noise floor by 0.05 or less and they get the disagreements right at
   least as often as A1 does. If both qualify, whichever is right more often on the
   disagreements wins; a tie goes to the cheaper one at API list price, which is A5, since
   Google's free tier costs nothing. A5 still has to clear its own speed check: at one call
   at a time, its seconds per call times 2,400 calls has to fit inside 48 hours; if it
   doesn't, the job goes to whichever setup qualifies next, and the write-up says so.
   Whichever model this leaves, if it's the same model already chosen as the proposer, it's
   skipped too, and the job goes to the next qualifier, or to Opus 5.5 if none is left. If
   the proposer is Opus 5.5 itself, so Opus can't be the adversary, and neither A4 nor A5
   qualifies, the job goes to whichever of A4 and A5 is right more often on the
   disagreements anyway, a tie going to A5 (cheaper), subject to the same 48-hour check, or
   to A4 if A5 fails it; the write-up says it didn't clear this rule's own bar.
4. **Self-preference.** Measured and reported, not decided anew: whether an adversary
   breaks its own model family's reasons at least 15 points less often than everyone
   else's. `insights/setup.json` already refuses pairing an adversary with the proposer's
   own model, the only pairing in the full run where self-preference could bite, since
   every candidate there comes from the one chosen proposer; this rule can only confirm
   that ban was justified, not change the choice. Haiku, Sonnet, Opus and Gemini each count
   as their own family; A5 has no candidates from its own family in the pool, so there's
   nothing here for it to confirm.
5. **Samples.** Use the smallest number of samples from 1 to 5 that finds at least 90% of
   the chosen proposer's reasons rated good at 5 samples. "Good" is whatever the owner rated
   yes.
6. **Attacking only the shown reasons.** Turn this on if at least 80% of all the breaks land
   on the top 3 reasons by support, the ones a page would actually show.

The setup these rules choose gets written to a committed file the full run reads.

## Rating

The owner rates in order: first 60 reasons blind, 15 per proposer setup, one passing reason
per finding, drawn at random from 15 of the 16 findings chosen with the seed, the same 15
findings for every setup; then the disagreements, every candidate where the runs don't all
agree, capped at 40, above that a seeded sample spread across the different ways the runs
split; then 10 items already rated, back for a second blind pass. Each part is shuffled with
the seed on its own, and no item shows its setup, model or stage; every item shows in
English and French. The owner answers yes, no or skip, a skip counting toward nothing; the
owner's agreement with their own earlier answers on that last part (kappa) is reported as a
drift check.

## What this pilot can tell apart

One setup's blind yes rate, read from 15 ratings, carries an interval of about 25 points
either side. 2 setups need to differ by about 35 points before that gap is clear rather than
noise. The 10 points rule 1 allows falls inside that noise by design: it leans toward the
cheaper setup when the difference isn't clear. That's the boundary this design draws.

The pilot's findings, its pool and its rating draws all come from one fixed seed: **20260925**.
