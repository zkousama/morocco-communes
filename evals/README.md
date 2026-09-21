# MCP eval

Asks a model real questions with the MCP server as its only tools, and checks the answers
against the dataset. It tests the part of the server a client meets: whether a model picks
the right tool from its description, how many calls an answer takes, and whether the figure
it reports is the one in `data/v1`.

```sh
pnpm api:dev                                  # in another terminal
pnpm eval                                     # every case, on Sonnet
pnpm eval --model haiku                       # a weaker model finds weaker descriptions
pnpm eval --only ktama,titwan --concurrency 2
pnpm eval --tool get_indicators               # the cases that expect one tool
pnpm eval --compare evals/results/<run>.json  # what moved since an earlier run
```

Each question goes through `claude -p`, so it runs on a Claude Code login and spends that
plan's usage, not an API bill. User settings are skipped and the model starts in an empty
directory, with no built-in tools, so nothing but the question and the server reaches it.

`cases.ts` holds 49 questions: lookups, misspellings and exonyms, French and Arabic,
coordinates, rankings, the census indicators, what changed between the 2014 and 2024
censuses, the 2024 establishments, 2 things the tools once couldn't answer directly, and
2 figures that don't exist, which commune borders which, and the urban dwellings that
stand empty. Some need 2 tools in a row,
and some name a place that is a commune and a province at once. Every expected figure is read from `data/v1`,
or from the running API where it depends on a boundary, so the cases stay right when the
data is rebuilt. A figure matches however it's written: `6,124`, `6 124`, `٦١٢٤`, or
rounded to the precision the data gives it.

A case passes when the answer holds every expected name and figure and the expected tools
were called, and counts as slow when it took more calls than its budget. Results go to
`evals/results/`, which isn't committed, with every call, its input and any error.

Each case also records what it cost, read off the CLI's own result event: input tokens
split into fresh, written to the cache and read back from it, output tokens and the part
of them spent thinking, dollars at API list price, wall time, API time and time to the
first token. A case asked twice, because the first answer reached no tools, is charged
for both. A run records the model the API says answered, which an alias like `sonnet`
doesn't say, the CLI's version, the commit and whether it had uncommitted changes, the
dataset version, and the tool list the server sent before any question, to the character.

The summary gives each category's passes, calls, tokens and cost, then the median, 90th
percentile and worst case for calls, turns, seconds, first token, tokens and cost, the
share of input read from the cache, the 3 costliest cases and the wall and API time.
`--compare` puts a run beside an earlier one, on the cases both asked: passes, calls,
turns, tokens, cost and the size of the tool list, each with its change, then every case
that flipped and the 5 whose call count moved most.

The dollars are what the same tokens would cost on the API. On a Claude Code login a run
spends the plan's usage instead, which these track but don't equal.

## What it has found

Every one of these was a right answer that cost too much, or a tool a model couldn't use
from its description. The count in brackets is the tool calls that one question took
before the change.

- **A city's arrondissements (31).** Casablanca's most populous arrondissement, because no
  tool listed a city's arrondissements. `get_commune` now returns them with their
  population.
- **Comparing the régions (12).** One `get_indicators` call per région. It now takes a
  `level` and returns every unit of it at once.
- **A name two levels share.** `list_communes` refused `province: "taroudannt"`, since the
  slug resolved to the commune of the same name. A filter now reads a shared name at the
  level it asks for, in the HTTP API too.
- **A city's establishments (56).** Asked which commune holds the most jobs, Sonnet read
  the 41 arrondissements one at a time: the 6 cities divided into them carry no figures of
  their own, and nothing gave the arrondissements together. They now come in one file, and
  both figure tools take `arrondissement` as a level. The same question takes 2 calls.
- **How many cercles a province has (2, wrong).** Haiku answered 4 for Taroudannt's 6,
  counting the cercles it could see on one page of communes. Nothing returned a unit above
  the commune, though its own record carries the count. `get_unit` does, with the units
  under it named.
- **A sort that arrived quoted twice (81).** Haiku sent `sort` as `"-labour.unemploymentRate"`
  with the quotes inside the string, was refused, gave up on sorting and read 75 communes
  one by one. A value is now taken as it was meant, and that question takes 1 call.
- **Two topics that sound alike.** Haiku asked `employmentStatus` for an unemployment rate
  and reported that the census doesn't publish one. It does, under `labour`; the parameter
  now says which is which.
- **A sum done in the answer (19, then 4).** Every question about one of the 6 cities the
  census counts by arrondissement ended with a model reading 16 or 41 rows into its
  context and adding them up: slow, ~6,000 tokens of JSON, and arithmetic nobody checked.
  Every figure in this workbook is a count, so a city's is the exact sum of its own
  arrondissements, and the dataset publishes it that way, marked
  `basis: arrondissement_sum` as the 2014 population on the same 6 cities already was.
  Casablanca's is checked against a second grouping of the same 16 units, the 8
  préfectures d'arrondissements HCP publishes. Asked how many establishments Casablanca
  has, a model now makes 2 calls and reports 150,953 with where it came from; asked which
  commune holds the most jobs, 1.

After those changes, on all 49 questions:

| Model | Passed | Tool calls | Over budget |
|---|---|---|---|
| Sonnet | 49 | 88 | 0 |
| Haiku | 49 | 83 | 0 |

The two models land within a few calls of each other, and the gap moves run to run. What
doesn't move is the shape of an answer: a figure that was summed comes back saying so, and
both models pass that on rather than reporting it as a count HCP published.
