# Insights pilot

The insights pipeline proposes reasons for a census figure that stands out, then has an
adversary argue with each one. This pilot tries several model setups on a small fixed sample
before a full run commits to one.

## What it asked

1. Which setup should propose the reasons: Haiku 4.5, Sonnet 5 at medium or high effort, or
   Opus 5.5 at medium effort?
2. How hard should the adversary think: Opus 5.5 at medium effort, or at high?
3. Which model should play the adversary: Opus 5.5, Sonnet 5 at high effort, or Gemini 3.8
   Flash?

The same results also set how many samples the proposer asks for, and whether the adversary
argues only with the reasons a page would show.

## How it ran

Every measure and the rules for reading them are in [the preregistration](preregistration.md),
committed before the first pilot call.

Stage A asked each proposer setup for reasons on the same 16 findings, 5 samples each:

| Setup | Model | Effort |
| --- | --- | --- |
| P1 | Haiku 4.5 | none |
| P2 | Sonnet 5 | medium |
| P3 | Sonnet 5 | high |
| P4 | Opus 5.5 | medium |

Stage B drew a pool of up to 30 passing candidates from each proposer setup, and had 5
adversary runs argue with every candidate in it:

| Run | Model | Effort |
| --- | --- | --- |
| A1 | Opus 5.5 | medium |
| A2 | Opus 5.5 | medium, a second run of the same setup |
| A3 | Opus 5.5 | high |
| A4 | Sonnet 5 | high |
| A5 | Gemini 3.8 Flash | its own default |

A1 and A2 are the same setup run twice. How far those 2 runs disagree is the noise floor
every other comparison between runs is read against.

A5, Gemini 3.8 Flash, was dropped before it could be measured: the free tier caps it at 20
requests a day ([the amendment](preregistration.md#amendment-26-september-2026)).

The owner then rated the candidates blind: first a sample of the reasons, then every
candidate the runs disagreed on (capped at 40, with a seeded sample above that), then 10 of
those items again for a drift check. No item showed its setup, model or stage.

## Results

<!-- results:start -->
<!-- results:end -->

## What it decided

Written after the pilot runs.

## What it cost

Written after the pilot runs.
