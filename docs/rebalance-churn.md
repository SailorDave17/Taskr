# What staying stable costs

- Story: #41 — bound the minutes a re-balance moves
- Command: `npm run rebalance:corpus`
- Corpus: [`src/lib/allocation.corpus.js`](../src/lib/allocation.corpus.js), perturbed by the rule in
  [`src/lib/rebalance.corpus.js`](../src/lib/rebalance.corpus.js)

Every figure on this page is **re-derivable**. Run the command; a test in
`src/lib/rebalance.test.js` fails when this document and the command disagree, so the numbers here
cannot quietly fall behind the corpus they describe.

[`docs/allocation-corpus.md`](allocation-corpus.md) is the companion page. That one asks whether the
household can be level. This one asks what it costs to stay recognisable while getting there.

## The question this page exists to answer

The charter's prototype gate recorded three findings, and the second is this story:

> **Re-balancing churns 8–10 of 14 jobs.** This is the kill condition named for derived allocation,
> observed on the first run and currently unmitigated. Net *counts* barely move while *minutes* move
> a lot, so the churn is mostly invisible in a count and very visible on a person's list.

Nobody knew whether a stability rule that keeps churn tolerable also destroys levelness. If it did,
the signature moment would be in tension with itself and its form would have to change. **It does
not**, and the table below is the measurement that says so.

## How the corpus is perturbed

**One stated rule, applied to all thirteen shapes: the largest capacity in the household is halved.**

Uniform on purpose. A capacity change hand-picked per shape could be chosen — even honestly, even
unconsciously — to produce the churn the story wants to see, and then the baseline below would be
measuring the fixture rather than the allocator. What a uniform rule costs is realism in individual
shapes; what it buys is a number nobody can lean on.

The largest capacity, because the split is proportional, so the biggest budget is carrying the most
minutes and taking half of it away is the perturbation with the most work to redistribute. Halved
rather than cut by a fixed number of minutes, because a fixed cut is enormous against a 25-minute
budget and a rounding error against a 300-minute one.

## The recorded figures

Last re-derived 2026-08-25, on the corpus as committed. Thirteen shapes, **43 jobs held by somebody**
before the change — that is the denominator, because work nobody holds cannot churn.

| Change budget | Jobs moved | Minutes moved | Shapes reaching level | Shapes the budget bound |
|---|---|---|---|---|
| no stability rule | 25 of 43 | 1240 | 3 of 10 | — |
| 0 minutes | 0 of 43 | 0 | 2 of 10 | 6 of 13 |
| 30 minutes | 5 of 43 | 130 | 1 of 10 | 4 of 13 |
| 60 minutes | 8 of 43 | 220 | 1 of 10 | 3 of 13 |
| 120 minutes | 11 of 43 | 355 | 2 of 10 | 2 of 13 |
| unbounded | 16 of 43 | 510 | 2 of 10 | 0 of 13 |

The first row is the **baseline** — the allocator #40 shipped, which has no stability rule because
there was nothing to be stable against. **120 minutes is the shipped value of
`CHANGE_BUDGET_MINUTES`**; the reasoning is under *What the table says* below.

The budget labels are deliberately plain rather than decorated. Each row is asserted **whole,
including its label**, by `src/lib/rebalance.test.js` — MEASURED while proving those tests, a check
that matched the numbers without the label passed happily when every arm collapsed onto the same
figures, because the unbounded row really was in the table. A doc-agreement test that does not tie a
row to the thing it is a row ABOUT is satisfied by its neighbours.

"Shapes reaching level" counts only the ten where levelness is a real question — two or more members
with capacity. The other three are level because a set with fewer than two elements has no spread,
which is the same vacuous pass `docs/allocation-corpus.md` refuses to fold into a headline.

## What the table says

**The baseline churns 58.1% of the household's jobs**, which is inside the prototype's measured
8–10 of 14 (57.1%–71.4%). That is the first thing the story needed to know, and it is a fact about
the **corpus** rather than about the allocator: a corpus that did not reproduce the problem would
have reported a triumphant zero for every stability rule tested against it. #41 AC 2 makes this a
failing test rather than a paragraph.

**The tie-break alone does most of the work.** Preferring the incumbent when two members would end
on exactly the same share is free — the allocation is equally level either way — and it takes churn
from 25 jobs and 1240 minutes to 16 jobs and 510 minutes. **Fifty-nine per cent of the minutes, for
no levelness cost at all** at the corpus level.

**Levelness barely responds to the budget.** Between 1 and 2 of the ten contested shapes reach level
at every setting from 0 to unbounded. Almost every shape that cannot be level is held there by the
granularity floor `docs/allocation-corpus.md` records, and no amount of movement fixes that. So the
change budget is **not a fairness dial**, and choosing its value by maximising levelness would be
reading noise.

**Exactly one shape is a real tradeoff.** "Roomy" — three 300-minute budgets, one of them halved —
can return to level, and needs **80 minutes** of movement to do it. It is the only place in the
corpus where spending churn buys fairness. That measurement is what set the shipped budget: 120
clears 80 with room, 60 does not and refuses the one repair available.

## The two costs, stated rather than buried

**Stability costs one shape's levelness.** The baseline reaches level in 3 of 10 contested shapes
and every stabilised arm reaches 2 or fewer. The shape that flips is *"a chore nobody may do"*: two
10-minute chores across budgets of 50 and 100. Preferring the incumbent on a tie hands the second
chore back to the member who already took the first, where the unstabilised allocator's roster-order
tie-break happened to split them. Both choices are ties **at the moment the chore is placed** — the
difference only appears in the final spread, and a greedy allocator cannot see that far ahead.

**Levelness is not monotone in the budget.** 0 minutes reaches level in 2 shapes, 30 and 60 reach it
in 1, and 120 reaches it in 2 again. A partial spend can be worse than no spend: the budget pays for
the largest job first, which is the biggest single improvement available, and then has nothing left
for the smaller move that would have finished the repair. This is a real property of a greedy
budgeted allocator, not a rounding artefact, and it is recorded rather than smoothed away.

## Minutes, never counts

Every figure above is in minutes as well as jobs, and the minutes column is the one that matters —
the prototype's third finding. The starkest case is not in the corpus but in
`src/lib/rebalance.test.js`: two members swap a 20-minute job for an 80-minute one, **every member
holds exactly as many jobs as before**, and 100 minutes change hands. A re-balance described in
counts reports that nothing happened. It would be telling the truth, and the household would learn
nothing.

## What "moved" means

A job has **moved** when it had a holder in both allocations and the holder is not the same person.
Deliberately not "appears in one and not the other": a chore that became impossible for everybody
left somebody's list, but it moved nowhere, and counting it as churn would charge a re-balance for
work that stopped existing. Newly-created work is excluded for the same reason — it has no previous
holder to have been taken from.

The reported figures are computed by **diffing the two allocations**, never read from the counter the
allocator keeps to spend the budget. Those are different numbers and must be: the counter charges
only *discretionary* moves, so when a member leaves the household and their chores are redistributed,
the counter reads zero while the household watches its list rearrange. Reporting the counter there
would tell them nothing moved on the week it moved most.

## The mutation record — #41 AC 9

The criterion asks that the tests each mutation should redden are **written down before the run**,
and the actual red set recorded against that prediction. That is the one act which has caught every
hard instance of a vacuous test in this workspace, because an unwritten prediction is fitted to
whatever happened and then reads as confirmation.

Baseline before mutating: **128 tests green** — `src/lib/rebalance.test.js` (51) and
`src/lib/allocation.test.js` (77), the second included deliberately so a change to the shared
placement rule cannot break #40 unnoticed. A **no-mutation control** was run through the same driver
first and returned 128 collected, 0 red: a prediction of zero agrees perfectly with a harness that
never ran.

| Mutation | Predicted | Actual | Verdict |
|---|---|---|---|
| control — nothing changed | 0 | 0 | harness live |
| incumbent preference removed | 8 | 8 | match |
| incumbent preference inverted | 11 | 11 | match |
| change budget removed | 10 | 10 | match, **after a repair** — see below |
| churn read from the budget counter, not the diff | 2 | 2 | match |
| one number changed in this document | 2 | 2 | match |
| the capacity change made a no-op | 11 | 11 | match |
| a manual pin made advisory | 23 | 22 | explained |
| an ineligible incumbent kept anyway | 2 | 2 | match |
| minutes reported as a count of jobs | 12 | 11 | explained |

### The finding, and what it changed

**Removing the change budget entirely reddened 5 against a predicted 10.** Actual below predicted is
a fact about the suite, and the missing five were the recorded-table tests. The cause: they asserted
that this document *contained a row with those numbers*, not that the row **labelled with that
budget** did. With the budget removed every arm collapses onto the unbounded figures — and the
unbounded row really is in the table, so each budget found somebody else's row and passed.

The repair was to assert each row whole, starting with its label. Re-running every mutation
afterwards — because the tests had changed, so the first round had stopped being evidence about
them — put it at 10 of a predicted 10.

### The two explained misses

**A manual pin made advisory reddened 22 of a predicted 23.** Only one of the corpus's two pinned
shapes moved: *"a chore a human already placed, and the split absorbs it"* stayed green because,
as that scenario's own stated reason says, it reaches the same end state with or without the human
in the loop. It is the pinned twin of the flagship's problem — a fixture that cannot discriminate —
and *"a human placement the allocator will not undo"* is the one that can, which is why the corpus
carries both.

**Minutes reported as a count reddened 11 of a predicted 12.** The row that did not move is
**0 minutes**, and it cannot: at a zero budget nothing moves, so a count of jobs and a sum of minutes
are both zero and the row is blind to which unit produced it. The other four rows and the swap
fixture in `src/lib/rebalance.test.js` carry that claim.
