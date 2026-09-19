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
```

Each question goes through `claude -p`, so it runs on a Claude Code login and spends that
plan's usage, not an API bill. User settings are skipped and the model starts in an empty
directory, with no built-in tools, so nothing but the question and the server reaches it.

`cases.ts` holds 37 questions: lookups, misspellings and exonyms, French and Arabic,
coordinates, rankings, the census indicators, what changed between the 2014 and 2024
censuses, 2 things the tools once couldn't answer directly, and a place that doesn't
exist. Every expected figure is read from `data/v1`,
or from the running API where it depends on a boundary, so the cases stay right when the
data is rebuilt. A figure matches however it's written: `6,124`, `6 124`, `٦١٢٤`, or
rounded to the precision the data gives it.

A case passes when the answer holds every expected name and figure and the expected tools
were called, and counts as slow when it took more calls than its budget. Results go to
`evals/results/`, which isn't committed, with every call, its input and any error.

## What it has found

The first run, on Sonnet, answered all 34 correctly, in 110 tool calls:

- Casablanca's most populous arrondissement took 31 calls, because no tool listed a city's
  arrondissements. `get_commune` now returns them with their population.
- Comparing the 12 régions took one `get_indicators` call per région. It now takes a
  `level`, and returns every région or province in one call.
- `list_communes` refused `province: "taroudannt"`, since the slug resolved to the commune
  of the same name. A filter now reads a shared name at the level it asks for, in the HTTP
  API too.

After those changes, on the same 34 questions:

| Model | Passed | Tool calls | Over budget |
|---|---|---|---|
| Sonnet | 34 | 60 | 0 |
| Haiku | 34 | 54 | 0 |

The 3 questions about the two censuses were added when the 2014 figures landed, and
Sonnet answered all 37 in 72 calls. One of them asks for a figure that doesn't exist:
Casablanca has no 2014 row, and the answer says so and points at the arrondissements.
