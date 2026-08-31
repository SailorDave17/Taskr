# The extraction bet, graded against a live model — #206

## Metadata

- **Run date:** 2026-08-31 (transcript `recordedAt` 2026-08-31T17:26:19.274Z)
- **Corpus revision:** `src/lib/extraction.corpus.js` blob `db14680`, last moved by #202 on
  2026-08-28 — 60 descriptions, 50 answerable, 10 deliberately ambiguous
- **Prompt configuration:** `DEFAULT_PROMPT`, fingerprint `3b5bce805746`, identical across both
  configurations — the two differ only in model and effort
- **Transcript:** [`extraction-run-2026-08-31.transcript.json`](extraction-run-2026-08-31.transcript.json)
- **Repo at:** `e455469`

Reproduce every figure below with no key and no network:

    npm run extraction:run -- --transcript docs/extraction-run-2026-08-31.transcript.json

*Verified 2026-08-31*: the replay was run with `ANTHROPIC_API_KEY` removed from the environment
entirely and reproduced **every graded figure identically**. The transcript is a record, not a
summary — a replay against a changed corpus misses rather than mismatches, and a miss refuses the
whole report.

## The headline

| | within tolerance | due dates exact | cost / household / year | provider p95 |
|---|---|---|---|---|
| `claude-opus-5` effort low | **44 of 50 (88.0%)** | 20 of 25 (80.0%), **0 invented** | $0.23 | 3060 ms |
| `claude-haiku-4-5` | **43 of 50 (86.0%)** | 21 of 25 (84.0%), **1 invented** | $0.03 | 1659 ms |

**Both configurations clear every kill condition that has a figure.** There is no provisional stop
(AC 7). Three axes remain *not measured* on both — deployed-path latency (#205), correction rate
(needs the capture flow in production), and the cost axis as the thresholds module computes it,
which is filled in by hand below rather than by the runner.

**Two points apart is not a difference.** 44 and 43 of 50 sit inside each other's noise on a
60-item corpus graded once. What separates these two configurations is not the headline score —
it is *which* mistakes each makes, and those point in opposite directions.

## Where each figure sits between floor and ceiling

The scale is [`extraction-corpus.md`](extraction-corpus.md)'s, measured 2026-08-25 and graded on
every CI run. Floor = an extractor that answers with nothing; ceiling = the corpus's own answers.

| Axis (all, n=50) | Floor | `claude-opus-5` low | `claude-haiku-4-5` | Ceiling |
|---|---|---|---|---|
| within tolerance | 0 of 50 | **44** | **43** | 50 of 50 |
| unattributed | 70 | **2** | **2** | 0 |
| misattributed | 0 | **2** | **2** | 0 |
| refusals | 0 | **13** (9 correct, 4 on answerable) | **12** (10 correct, 2 on answerable) | 10, all correct |
| overconfident | 10 of 10 | **1 of 10** | **0 of 10** | 0 of 10 |
| due dates exact (n=25) | 0 of 25, 0 invented | **20**, 0 invented | **21**, **1 invented** | 25 of 25, 0 invented |

Both land far nearer the ceiling than the floor on every axis. The one figure that is *worse* than
the floor on its own terms is **misattribution**: the floor misattributes nothing, because an
extractor that answers with nothing cannot put a job on the wrong person. Two misattributions is a
small number and it is not comparable to zero — it is a different failure, and the corpus doc says
so.

**Per-kind floor and ceiling are not separately recorded.** Both kinds carry 25 answerable and 5
ambiguous, so the per-kind scale is 0-of-25 to 25-of-25 **by derivation, not by measurement** —
marked as derived rather than quoted.

| Per kind | `claude-opus-5` low | `claude-haiku-4-5` |
|---|---|---|
| capacity, within tolerance | 23 of 25 (92.0%) | 20 of 25 (80.0%) |
| capacity, absolute error | **0 minutes**, worst 0 | **305 minutes**, worst **225** on one entity |
| chores, within tolerance | 21 of 25 (84.0%) | 23 of 25 (92.0%) |
| chores, due dates exact | 20 of 25, 0 invented | 21 of 25, **1 invented** |

**The two invert per kind.** Opus is stronger on capacity and weaker on chores; Haiku is the
reverse. Neither ordering survives being called a ranking on one run of 30 items per kind.

## The failure the headline hides

`claude-opus-5` at effort low returned **5 responses the adapter could not parse**; Haiku returned
**none**. The adapter converts an unparseable response into a refusal, which is the honest thing to
do — so the grader's `unparseable 0` row is a statement about the *contract shape it received*,
while the adapter's `unparseable-response 5` is a statement about *the wire*. Two rows, the same
word, different subjects. The adapter tally is the one to read for provider reliability:

| | refusal | unparseable-response | http-error | timeout | transport-error |
|---|---|---|---|---|---|
| `claude-opus-5` low | 8 | **5** | 0 | 0 | 0 |
| `claude-haiku-4-5` | 12 | 0 | 0 | 0 | 0 |

So of the 13 refusals Opus is scored on, **5 were not refusals at all** — they were malformed
answers, counted the safe way. That is the more capable model being *less* reliable in output shape
at low effort, and it is invisible in the 88.0% headline.

**This is why AC 2 required two configurations.** With one number there is no way to tell a bet
that fails from a prompt or an effort setting that was chosen badly.

## Latency — the provider's own contribution only

p50 and p95 per extraction, derived from the transcript's per-response elapsed time.

| | capacity p50 / p95 | chores p50 / p95 | all p50 / p95 |
|---|---|---|---|
| `claude-opus-5` low | 2305 / 3060 ms | 2305 / 3317 ms | 2305 / 3060 ms |
| `claude-haiku-4-5` | 926 / 1766 ms | 998 / 1327 ms | 965 / 1659 ms |

**These are not the numbers the kill condition is specified against, and must not be read as though
they were.** This measures one developer machine to the provider and nothing else. The kill number
is named on the **deployed** path, which also carries the phone's transport and the Edge Function's
cold start — #205 measures that half. The thresholds report correctly prints `p95, deployed path —
not measured` on both configurations, and it should keep printing that until #205 lands. A
provider-only figure entered against a deployed-path threshold would be a real measurement of the
wrong thing, which is worse than none because it looks like an answer.

## Cost

Computed from the `usage` block each response carries — input and output tokens, priced per
million — and then **reconciled against the provider console**.

| | figure |
|---|---|
| token-derived total for the 120 recorded calls | **$0.2994** |
| plus the one-call smoke test that preceded the run | **$0.3000** |
| console-reported spend for the day (owner, 2026-08-31) | **$0.30** |

They agree. That reconciliation is what makes the per-extraction figures below evidence rather
than arithmetic: it confirms the **price basis** and the **token accounting**, the two inputs
that could have been wrong by an order of magnitude without anything here looking odd. What it
does **not** confirm is the year projection, because a year has not happened — that remains an
extrapolation from per-extraction cost across a stated usage model, which is what the criterion
asks for. A console total also cannot break down per kind or per configuration, so the tables
below stay token-derived; the console bounds their sum.

Price basis: `claude-opus-5` $5.00 in / $25.00 out per MTok; `claude-haiku-4-5` $1.00 / $5.00
(Anthropic first-party list, as published 2026-06-24). Cache reads were **zero throughout** — every
call paid full input price, which is the conservative direction.

| | mean tokens in / out | cost per extraction |
|---|---|---|
| `claude-opus-5` low — capacity | 607 / 49 (18 thinking) | $0.004271 |
| `claude-opus-5` low — chores | 604 / 58 (12 thinking) | $0.004456 |
| `claude-haiku-4-5` — capacity | 449 / 29 (0 thinking) | $0.000593 |
| `claude-haiku-4-5` — chores | 449 / 42 (0 thinking) | $0.000659 |

**Projection — one household updating capacity weekly and capturing chores at setup, for a year**
(52 capacity extractions + 1 chores capture):

| | cost per household per year | kill number | verdict |
|---|---|---|---|
| `claude-opus-5` effort low | **$0.2265** | <= $5.00 | **PASS** — 22x under |
| `claude-haiku-4-5` | **$0.0315** | <= $5.00 | **PASS** — 159x under |

**Cost is not a live constraint on this bet, and it is not close.** Even the expensive
configuration spends under a quarter of a dollar per household per year. That has a design
consequence worth stating: **cost cannot be the reason to prefer Haiku here.** At these magnitudes
the difference is twenty cents a household a year, and the axis that should decide between them is
the invented date and the 225-minute error, not the bill.

## How many prompt revisions produced this figure — AC 6

**Zero.** `src/lib/extractionAdapter.js` — which carries `DEFAULT_PROMPT` — has exactly one commit
in its history, `942a8d7`, the #203 story that wrote it. The prompt was not tuned against the
corpus, not iterated, and not revised between a first run and this one. This is the **first** live
run of the prompt as written.

That is the strongest single fact in this document. A score of 88% reached on the first attempt and
the same score reached after twenty prompt revisions are different facts about a bet: the first
says the task is close to the model's natural behaviour, the second says the corpus has been fitted
and the figure will not survive contact with sentences nobody wrote for it. #207 — real member
sentences — is where that gets tested, and it starts from an unfitted prompt.

## Kill conditions — the full sheet, both configurations

Every axis with a figure **passes** on both. Reproduced verbatim by the replay command above.

                                    claude-opus-5 low     claude-haiku-4-5     threshold
    within tolerance (all)          44 of 50   PASS       43 of 50   PASS      >= 35 of 50
    ambiguous refused (all)          9 of 10   PASS       10 of 10   PASS      >= 7 of 10
    overconfident (all)              1 of 10   PASS        0 of 10   PASS      <= 2 of 10
    due dates exact                 20 of 25   PASS       21 of 25   PASS      >= 18 of 25
    p95, deployed path                    not measured — needs transport and cold start (#205)
    cost per household per year     $0.2265    PASS       $0.0315    PASS      <= $5.00
    correction rate                       not measured — needs the capture flow in production

The cost row is filled in here by hand from the transcript; the runner still prints it as
*not measured*, because nothing feeds `costPerHouseholdPerYearUsd` into the thresholds module. That
is a real gap between this document and the instrument, recorded rather than papered over — see
below.

## What this run does not settle

- **The deployed path.** Every latency figure here is provider-only. #205 measures the round trip
  from a phone, and the kill number is specified on that.
- **Correction rate.** Needs the capture flow in front of real members.
- **Real sentences.** This corpus was written for the bet. #207 takes the verdict against
  descriptions real household members write, which is the test that can still kill it.
- **One run, one day.** No figure here has a confidence interval. Two points between the
  configurations is not a difference, and neither is four.
- **The runner does not compute cost.** The projection above is derived in this document, so it can
  drift from the instrument. Feeding `costPerHouseholdPerYearUsd` into `extractionThresholds.js`
  would close that; it is not in #206's criteria and is not done here.

## The key

The provider key was read from the environment for the recording command only. It is sent in one
header and stored nowhere — not in the transcript, which holds responses and never requests or
headers, and not in this report. Verified after the run by searching every tracked and untracked
file in the repo, with a planted dummy as the positive control proving the search detects what it
is looking for — AC 8.
