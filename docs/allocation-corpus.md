# The allocation corpus, and what it measures

- Story: #40 — divide work by capacity and say when level is unreachable
- Command: `npm run allocation:corpus`
- Corpus: [`src/lib/allocation.corpus.js`](../src/lib/allocation.corpus.js)

Every figure on this page is **re-derivable**. Run the command; a test in
`src/lib/allocation.test.js` fails when this document and the command disagree, so the numbers here
cannot quietly fall behind the corpus they describe.

## What the allocator claims

Chores are minutes of work and people are budgets of minutes, so **fair means every person carries
the same share of their own capacity**. A parent with 300 minutes and a kid with 60 are level when
both sit at 50% — five chores against one. Equal shares are not equal counts, and the corpus's
flagship scenario exists to make that concrete.

## What "level" means here

Level when the spread between the highest and lowest share is **at or under 10 percentage points**
(`LEVEL_TOLERANCE`). Owner-set at pickup of #40, bounded on both sides:

- **Below 15pp**, because the charter records the prototype as ragged at 15% spread. A tolerance at
  or above that would call a measured-ragged set level, which is the single failure the honesty half
  of this module exists to prevent.
- **Not so tight that ordinary indivisibility trips it**, because the charter's other constraint is
  that a notice firing on healthy households is an absent notice — it takes the real one down with
  it.

## The recorded figures

Last re-derived 2026-09-18, on the corpus as committed — fifteen shapes since #481 added two (see
*What recent weeks say* below); the thirteen before it are unedited and their outcomes did not move.

| | Reaching level | Of | Proportion |
|---|---|---|---|
| All shapes | 12 | 15 | 80.0% |
| Shapes where level is a real question (2+ members with capacity) | 9 | 12 | 75.0% |

**Two figures, not one, and the second is the honest one.** Three of the fifteen shapes have fewer
than two members with any capacity — a household of one, a household with nobody in it yet, a week
where one member has no minutes. Those report level because a set with fewer than two elements has
no spread, not because the allocator achieved anything. Folding them into a single headline would
inflate it, and a number that quietly includes vacuous passes is the shape of claim this repo has
repeatedly found wrong.

## The three that cannot reach level, and why

- **A 25-minute budget against a 10-minute smallest job.** The granularity floor the prototype
  measured, reproduced exactly: the household sits near 69%, Ava should carry 17 minutes, and the
  smallest job available is 10 — so she lands on 40% or 80% and no arrangement puts her near 69%.
  Spread 36.7pp. This is the scenario that discriminates a correct allocator from a lying one; the
  flagship cannot, because 60/300 with six 30-minute chores divides exactly and both allocators
  produce the same output on it.
- **A human placement the allocator will not undo.** Sixty minutes pinned to a sixty-minute budget.
  Moving it is the only repair available and the allocator does not take it, because a person
  overrode the model on purpose. Spread 70.0pp.
- **One job larger than the whole household.** A 500-minute chore against 300 minutes of total
  capacity. Shares above 100% are meaningful and are not clamped: 250% is the household being told
  the truth about its week. Spread 230.0pp.

In each case the verdict carries a reason naming the person, their fair share in minutes, and the
smallest job on the list — the two numbers that make the arithmetic self-evident.

## What recent weeks say — #481

The allocator was memoryless until #481: it saw the current holder of each chore and nothing about
how it got there, and its tie-break is deterministic, so the same household dealt the same chore to
the same person week after week by construction — and a hand move off somebody was respected for a
week and forgotten the next. `0049` records every assignment change (`chore_assignment_history`),
[`src/lib/assignmentHistory.js`](../src/lib/assignmentHistory.js) folds the last weeks of it into
a **steer**, and the allocator takes the steer as an input exactly as it takes capacity and
eligibility — so a corpus shape can carry one, and the rule is argued about here.

### The two windows, as constants

Both are recorded in `assignmentHistory.js` with the same reasoning, and both read the weeks
**before** the one being dealt — a deal-out re-runs on every capacity change, and a window that
counted this week's own placement would flip a chore off its holder on a Tuesday re-run for having
landed on them on Monday.

- **`REPEAT_HOLDER_WEEKS = 3`.** In each of the last three weeks, **every** deal-out of the chore
  went to the same member. A week is read as a set, never by its last row: every row one deal-out
  writes shares one `recorded_at` and a random id, so "the last placement of the week" for a
  Mon+Thu repeat dealt to two people is uuid luck (review-fanout, 2026-09-18, reproduced in
  pglite) — such a week is not one person's week and breaks the run. Not two: a deterministic tie-break makes two weeks on one person what a tie
  *looks like*, and a rule firing on it would move a chore for no reason anybody could see. Not
  four: the capacity suggestion's window is four, and a signal that needs a month before acting is
  one the household stops waiting for — "week after week" is the owner's phrase, and three is the
  smallest run that is a habit rather than a coincidence.
- **`MOVED_OFF_MOVES = 2` of `MOVED_OFF_WINDOW_WEEKS = 3`.** In two of the last three weeks the
  chore was dealt to a member and a person then moved it off them onto somebody else. Not one of
  one: a single move is a week's circumstance. Not three of four: somebody who has disagreed with
  the split twice in three weeks has disagreed, and making them say so again is the negotiation the
  product exists to remove. Not wider than three weeks, so the steer stops within a month of the
  household stopping the moves.

**What AC 2 asks that the record cannot answer.** The criterion's Given is "while another eligible
member had spare capacity *in that week*". Prior weeks' capacity is readable (`member_capacity` is
keyed by week) but prior weeks' eligibility is not — `chore_exclusions` keeps no history — so the
spare-capacity half is evaluated for **this** week, at placement time, where the allocator checks
it exactly. The cost, stated: a chore that went to one person three weeks running because nobody
else could take it counts as a run, and is then steered off them only if somebody else has room
now.

### What each signal does, and the two shapes that pin it

- **Repeat** (AC 2) — the allocator *prefers* another eligible member whose resulting share is
  within `LEVEL_TOLERANCE` of the best. A wider gap is a fairness cost, and fairness of minutes is
  never traded for variety. *A chore that keeps landing on one person, and somebody else has room*:
  two equal budgets, dishes (40) and laundry (30); unsteered, dishes goes to `a` on the tie-break
  and the load is 40 against 30; steered, dishes goes to `b` and laundry to `a`, 30 against 40. The
  load flips, which is what makes the shape redden without the rule, since this corpus asserts
  minutes and never the chore-to-member map.
- **Moved off** (AC 3) — every member the chore was moved off often enough is a *last resort*
  (the fold names them all, most weeks first, so a second person the household kept moving it
  off is not invisible): another eligible member who would stay at or under their own capacity
  takes the chore, whatever the gap. Owner decision at pickup
  (2026-09-18) over the within-tolerance reading, which would have handed the chore straight back
  whenever that member was the lowest-loaded — the exact behaviour the owner reported. The off-level
  minutes this can cost are reported by the verdict, never hidden; the boundary (at capacity has
  room, one minute over does not) is asserted in `src/lib/allocation.test.js`.
- **Neither** fires for a chore only one member can do, and nothing then claims it could have (AC 4).
  *A chore only one person can do is not steered, and no line claims it could have been*: the same
  budgets and the same steer, `b` excluded from dishes; dishes stays on `a` at its full 40 and the
  allocator's `steered` list — which the Split reads its one-line "why" from — is empty.
- **The change budget** bounds a steer off the incumbent like any other discretionary move — at the
  budget it goes through, one minute under it is refused and nothing is reported as steered
  (`src/lib/rebalance.test.js`). The churn table in
  [`docs/rebalance-churn.md`](rebalance-churn.md) is measured over the thirteen shapes without a
  steer, and that page says why.

## How the expected outcomes were produced

**By hand, before the module was run against them** — the criterion in #40 AC 2, and not ceremony. A
corpus whose expectations were generated by calling the code under test asserts only that the code
still does what it did. That is what a regression suite gets for free, and it is the one thing a
fairness claim cannot rest on. Deriving the expected column by filtering the fixture's own expected
column is the same circle with a longer radius, and is excluded for the same reason.

What each scenario pins is minutes and chore-count per member, the levelness verdict, and the
reason. Deliberately **not** the chore-to-member map: which of two identical 30-minute chores lands
on which person is tie-break trivia rather than a product property, and pinning it would make a
future tie-break change look like a fairness regression. The ordering property that does matter —
that the same household in a different input order produces a byte-identical answer — is #40 AC 6,
and it is tested by comparing two runs rather than by writing a map down.
