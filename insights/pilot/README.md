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

Stage B drew a pool of up to 30 passing candidates from each proposer setup, for 5
adversary runs to argue with every candidate in it:

| Run | Model | Effort |
| --- | --- | --- |
| A1 | Opus 5.5 | medium |
| A2 | Opus 5.5 | medium, a second run of the same setup |
| A3 | Opus 5.5 | high |
| A4 | Sonnet 5 | high |
| A5 | Gemini 3.8 Flash | its own default |

A5, Gemini 3.8 Flash, was dropped before it could be measured: the free tier caps it at 20
requests a day ([the amendment](preregistration.md#amendment-26-september-2026)).

A1 and A2 are the same setup run twice. How far those 2 runs disagree is the noise floor
every other comparison between runs is read against.

The candidates were then drawn for a blind rating: first a sample of the reasons, then every
candidate the runs disagreed on (capped at 40, with a seeded sample above that), then 10 of
those items again for a drift check. No item showed its setup, model or stage.

A jury of 3 models from other families rated them in place of a person, each question going
to the majority, after the owner had answered 20 of the items as a spot-check
([the second amendment](preregistration.md#amendment-26-september-2026-who-rates)). The drift
check doesn't apply to a jury.

## Results

<!-- results:start -->

### Who rated

A jury of 3 models rated every reason and disagreement, each question going to the majority: J1 (`openai/gpt-oss-120b`), J2 (`qwen/qwen3.8-27b`) and J3 (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). No person's answers feed the rules.

The judges' agreement with each other, and the owner's spot-check on 20 items against the jury's majority, are reported only: no rule reads them. Kappa is Cohen's kappa, or 1 when the 2 sides agree on every answer.

| Between | Claim beyond premise | Link explains finding | Ignores obvious alternative | Sound | Breaks |
| --- | --- | --- | --- | --- | --- |
| J1 and J2, kappa | 0.48 (n 99) | 0.04 (n 99) | 0.04 (n 99) | 0.10 (n 99) | 0.40 (n 63) |
| J1 and J3, kappa | 0.08 (n 95) | 0.19 (n 95) | 0.17 (n 95) | -0.02 (n 95) | 0.09 (n 63) |
| J2 and J3, kappa | 0.03 (n 95) | 0.16 (n 95) | 0.14 (n 95) | 0.03 (n 95) | -0.00 (n 63) |
| All 3 judges, share agreeing | 66% (n 95) | 45% (n 95) | 52% (n 95) | 71% (n 95) | 35% (n 63) |
| Owner and jury, share agreeing | 85% (n 20) | 85% (n 20) | 75% (n 20) | 80% (n 20) | 39% (n 18) |
| Owner and jury, kappa | 0.00 (n 20) | 0.00 (n 20) | -0.09 (n 20) | -0.05 (n 20) | 0.04 (n 18) |

### Proposers

16 findings, 5 samples each. Every interval is 95%, from 2,000 bootstrap rounds over the findings.

| Setup | Model | Effort | Reasons | Tests passed | Refused | Missing | Usable answers | Reasons per finding | Entropy | Links consistent | Safety drops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Haiku 4.5 | none | 185 | 98% (95 to 100%) | tautology 3, too few places for that share 1 | 0 | 100% (100 to 100%) | 11.6 (10.4 to 12.8) | 2.30 (2.17 to 2.44) | 14 of 150 | none |
| P2 | Sonnet 5 | medium | 150 | 94% (90 to 98%) | tautology 4, too few places for that share 3 | 0 | 100% (100 to 100%) | 9.4 (8.3 to 10.5) | 2.05 (1.92 to 2.19) | 27 of 132 | none |
| P3 | Sonnet 5 | high | 152 | 99% (98 to 100%) | too few places for that share 1 | 0 | 100% (100 to 100%) | 9.5 (8.3 to 10.8) | 2.06 (1.91 to 2.20) | 26 of 136 | none |
| P4 | Opus 5.5 | medium | 126 | 100% (100 to 100%) | none | 0 | 100% (100 to 100%) | 7.9 (6.8 to 9.1) | 1.87 (1.74 to 2.01) | 21 of 91 | none |

| Setup | Yes rate | Rated | Cost at list price | Cost per call | Tokens in | Tokens out | Seconds per call |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | 23% (0 to 46%) | 13 | $5.76 | $0.072 | 916k | 1.1M | 127.5 |
| P2 | 0% (0 to 0%) | 14 | $3.32 | $0.042 | 1.1M | 266k | 37.3 |
| P3 | 7% (0 to 21%) | 14 | $5.33 | $0.067 | 1.1M | 464k | 153.8 |
| P4 | 0% (0 to 0%) | 14 | $4.71 | $0.059 | 1.1M | 179k | 22.3 |

### Adversaries

The pool: 120 candidates, 30 from P1, 30 from P2, 30 from P3, 30 from P4.

| Run | Model | Effort | Break rate | Argued | Unusable | Policy stops | Right on disagreements | Counter-tests upheld |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Opus 5.5 | medium | 74% (65 to 84%) | 119 | 1 | 0 | 55% (44 to 69%), n 40 | 43% (24 to 71%), n 23 |
| A2 | Opus 5.5 | medium | 78% (69 to 87%) | 120 | 0 | 0 | 68% (54 to 84%), n 40 | 46% (30 to 65%), n 26 |
| A3 | Opus 5.5 | high | 74% (65 to 84%) | 120 | 0 | 0 | 57% (42 to 74%), n 40 | 57% (40 to 75%), n 23 |
| A4 | Sonnet 5 | high | 57% (43 to 70%) | 116 | 4 | 0 | 40% (22 to 56%), n 40 | 15% (0 to 25%), n 13 |
| A5 | Gemini 3.8 Flash | its own default | dropped, not measured: the free tier caps Gemini 3.8 Flash at 20 requests a day |  |  |  |  |  |

| Run | Own family's reasons broken | Everyone else's | Gap | Cost at list price | Tokens in | Tokens out | Seconds per call | Seconds per call with waits | Waited |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 73% | 74% | 1 points (-16 to 25) | $8.62 | 1.6M | 108k | 12.9 | 12.9 | 0 s |
| A2 | 73% | 79% | 6 points (-18 to 37) | $5.39 | 1.6M | 108k | 12.7 | 12.7 | 0 s |
| A3 | 63% | 78% | 14 points (-1 to 32) | $8.80 | 1.6M | 132k | 18.4 | 18.4 | 0 s |
| A4 | 52% | 62% | 10 points (-5 to 25) | $7.67 | 1.6M | 443k | 49.0 | 49.1 | 5 s |
| A5 | dropped, not measured: the free tier caps Gemini 3.8 Flash at 20 requests a day |  |  |  |  |  |  |  |  |

A5's speed check didn't run: A5 was dropped and not measured (the free tier caps Gemini 3.8 Flash at 20 requests a day).

A3's extra breaks, the candidates it broke and A1 passed: 9 in the pool, 9 rated, 9 of those judged right.

### Agreement

Agreement between each pair of runs, over the candidates both answered usably: Cohen's kappa, or 1 when the 2 runs agree on every candidate. A1 and A2 are the same setup run twice, so their agreement is the noise floor: 0.70 (0.57 to 0.82).

| Run | A1 | A2 | A3 | A4 |
| --- | --- | --- | --- | --- |
| A1 |  | 0.70 (0.57 to 0.82) | 0.63 (0.46 to 0.80) | 0.37 (0.21 to 0.52) |
| A2 | 0.70 (0.57 to 0.82) |  | 0.68 (0.45 to 0.88) | 0.24 (0.06 to 0.38) |
| A3 | 0.63 (0.46 to 0.80) | 0.68 (0.45 to 0.88) |  | 0.21 (0.04 to 0.37) |
| A4 | 0.37 (0.21 to 0.52) | 0.24 (0.06 to 0.38) | 0.21 (0.04 to 0.37) |  |
| A5 | dropped, not measured: the free tier caps Gemini 3.8 Flash at 20 requests a day |  |  |  |

### Samples

The share of each setup's reasons rated good that its first samples already find.

| Setup | Rated good | 1 sample | 2 samples | 3 samples | 4 samples | 5 samples |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | 3 | 0% (0 to 0%) | 0% (0 to 0%) | 67% (0 to 100%) | 100% (100 to 100%) | 100% (100 to 100%) |
| P2 | 0 | none | none | none | none | none |
| P3 | 1 | 100% (100 to 100%) | 100% (100 to 100%) | 100% (100 to 100%) | 100% (100 to 100%) | 100% (100 to 100%) |
| P4 | 0 | none | none | none | none | none |

### Shown reasons

125 of 336 breaks across A1, A2, A3 and A4 landed on the top 3 reasons a page would show, by support among the ones that passed their data test: 37% (29 to 47%).

### Safety

1 of the pool's candidates matched a private term.

| Run | Policy stops | By category | Stopped with no term matched | Term matched, argued anyway |
| --- | --- | --- | --- | --- |
| A1 | 0 | none | 0 | 1 |
| A2 | 0 | none | 0 | 1 |
| A3 | 0 | none | 0 | 1 |
| A4 | 0 | none | 0 | 1 |
| A5 | dropped, not measured: the free tier caps Gemini 3.8 Flash at 20 requests a day |  |  |  |

Argued with a private term matched, by candidate id and category, with the runs that passed it:

- `9f0a6eae274e` (terms): A1, A2, A3, A4

### Drift

A jury rated, so there's no drift check.

### Decisions

| Rule | Choice | Why |
| --- | --- | --- |
| 1. Proposer | P1 (Haiku 4.5) | Best yes rate: 23% (P1). Within 10 points of it: P1 at $5.76 ($0.072 a call). Cheapest of those: P1. |
| 2. Adversary effort | high | A3's kappa with A1, 0.63, is more than 0.05 from the noise floor, 0.70. The jury judged 9 of A3's 9 rated extra breaks right, at least 2 in 3. |
| 3. Adversary model | A3 (Opus 5.5, high) | A4's kappa with A1, 0.37, is more than 0.05 from the noise floor, 0.70. A5 was dropped and not measured (the free tier caps Gemini 3.8 Flash at 20 requests a day), so it can't qualify. Nothing's left standing, so A3 keeps the job. |
| 4. Self-preference | no change | No run broke its own family's reasons at least 15 points less often than everyone else's. A5 was dropped and not measured. Reported only: the setup already keeps the adversary off the proposer's own model. |
| 5. Samples | 4 | Of P1's 3 reasons rated good, the first 4 samples find 100%, at least 90%. With one fewer, the first 3 samples find 67%. |
| 6. Attacking only the shown reasons | off | 125 of 336 breaks (37%) landed on the top 3 reasons a page would show, under 80%. |

<!-- results:end -->

## What it decided

The rules were applied as registered. They chose Haiku 4.5 to propose, with 4 samples, and
Opus 5.5 at high effort to argue, with every reason argued with as before.
[`insights/setup.json`](../setup.json) now holds that choice.

2 findings stand without the rating. High effort changes Opus's verdicts more than a second
run at the same effort does (kappa 0.63 between medium and high, against 0.70 between the 2
medium runs), and Sonnet 5 argues quite differently from Opus (0.37). Breaks land well outside
the reasons a page would show, with 37% on the top 3, so the adversary keeps arguing with
every reason.

The choice of proposer, the number of samples and the high effort rest on the jury, and there
the signal is weak. Under the checklist the jury judged few reasons sound: 3 of Haiku's 13
rated reasons, one of the 14 from Sonnet at high effort, and none from the other 2 setups. Its
3 judges agreed on which reasons were sound about as often as chance would give (kappa
between −0.02 and 0.10), and they agreed with the owner's 20 answers at the same level (kappa
0). Raw agreement ran high only because nearly every reason was rated unsound. Those 3 choices
follow the rules on that signal, and the full run's setup gets checked against this pilot's
data before any run uses it.

## What it cost

At API list prices the Claude calls came to about $50: $19 for the 4 proposer setups and $30
for the 4 adversary runs, paid through a subscription. Haiku cost the
most to propose, since it writes long answers, and Sonnet at medium effort the least. The jury
ran on free tiers: 297 calls, about 170,000 input tokens on Groq and 3,017 of Cloudflare's
10,000 free daily units.
