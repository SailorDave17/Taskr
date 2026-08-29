# The extraction corpus, and what it measures

- Story: #42 — score plain-language capacity extraction against a fixed corpus
- Story: #202 — score a proposed chore's due date as its own axis
- Command: `npm run extraction:corpus`
- Corpus: [`src/lib/extraction.corpus.js`](../src/lib/extraction.corpus.js)
- Grader: [`src/lib/extraction.js`](../src/lib/extraction.js)
- Date rules: [`src/lib/dueDates.js`](../src/lib/dueDates.js)

Every figure on this page is **re-derivable**. Run the command; a test in
`src/lib/extraction.test.js` fails when this document and the command disagree, so the numbers here
cannot quietly fall behind the corpus they describe.

## What this is for

The charter names extraction accuracy as one of three things that kill the AI bet — *"extraction
that is wrong often enough to erode trust in the numbers the fairness claim rests on"*. This is the
instrument that turns *accurate enough* into a number.

It is built **before** any extractor exists, and that is the point rather than an accident of
ordering. A corpus and a grader cost two days and can retire the bet; discovering the same thing
after a capture flow exists costs the flow as well. #56 stands up the endpoint, #43 drives a live
model through this same grader and records the verdict.

**Nothing in the app calls any of this.** It makes no network call, needs no API key and needs no
provider account — asserted by a source-reading test, not by inspection.

## Two input kinds, because the bet covers two

The issue body scopes the corpus to *"plain-language week descriptions"*. The charter's 2026-08-08
widening put chore capture inside the bet and said what that costs in as many words:

> #42's corpus was scoped to capacity descriptions only. A bet that covers chore capture needs chore
> descriptions in the same corpus, scored by the same grader, or the measurement that decides whether
> the bet survives is silent about half of what it now claims.

Owner decision at pickup, 2026-08-25: **both kinds, thirty each**. A capacity description yields
minutes attributed to named people; a chore description yields a job and how long it takes. An
extractor can plausibly be good at one and bad at the other, so every figure below is reported per
kind as well as overall.

| Kind | Descriptions | Answerable | Ambiguous |
|---|---|---|---|
| capacity | 30 | 25 | 5 |
| chores | 30 | 25 | 5 |
| all | 60 | 50 | 10 |

## How the expected outcomes were produced

**By hand, before any extractor was run against them** — AC 1, and the same rule the allocation
corpus states for the same reason. A corpus whose expectations were produced by calling the thing
under test asserts only that the thing still does what it did. That is what a regression suite gets
for free and the one thing an accuracy claim cannot rest on.

Each answerable description pins **minutes per named entity** and **a tolerance in minutes**. The
tolerance is a bound on the error for *any one* entity, not on the total: three people each fifteen
minutes out is three failures, not one that happens to sum badly. It is zero where the description
states a number outright, and wider where it hedges — *about* and *a couple* buy fifteen to thirty
minutes, an explicit range buys half the range.

## The ambiguous ten, and why they are not answers

Ten descriptions carry a stated **reason** instead of an invented expected value. They are the ones
that name no quantity (*"free most evenings"*, *"tidy up"*), refer to a baseline the text does not
contain (*"a bit more time than usual"*, *"about the same as last week"*), or offer two answers and
choose neither (*"three hours, or maybe five"*, *"could be an afternoon or could be ten minutes"*).

**An extractor that answers one of these with a confident number is counted separately from one that
is merely wide** — AC 6. The charter's kill condition is trust, and the two damage it differently: a
wide answer is visibly approximate, and a confident wrong one goes straight into the fairness
arithmetic looking like a fact. An overconfident answer reaches none of the error figures, so it can
neither inflate nor depress them.

## The scale — measured 2026-08-25, on the corpus as committed

A score means nothing without two known points to read it between. Both controls are graded on every
CI run.

| | Within tolerance | Attribution | Refusals | Overconfident |
|---|---|---|---|---|
| **Floor** — answers with nothing | **0 of 50** (0.0%) | 70 unattributed, 0 misattributed | 0 | 10 of 10 |
| **Ceiling** — the corpus's own answers | **50 of 50** (100.0%) | 0 unattributed, 0 misattributed | 10, all correct | 0 of 10 |

**The floor is what forced the grader's central design decision.** *Within tolerance* requires the
entity sets to match exactly, and that is not strictness for its own sake. An extractor that answers
with nothing has no matched entity, so a *worst error over what it named* is zero over an empty set —
grade tolerance on matched entities alone and the do-nothing extractor scores a perfect 100%. The
negative control is what discriminates the two designs, which is the whole reason an instrument is
built with one before it is trusted.

The arithmetic axis is still reported on its own, as `minutesWithinToleranceOnMatched`, because *got
the numbers right on the people it found* and *found the right people* are different failures with
different repairs, and one combined figure hides which happened.

**The denominator is every answerable description, never the ones the extractor chose to answer.**
Divide by what it answered and an extractor that refuses everything it is unsure of scores 100% — it
would be rewarded for narrowing the question until it could not get it wrong. Refusing an answerable
description is a miss.

## The due-date axis — #202, measured 2026-08-28

The chore contract carries a due-date field, so the verdict must not be silent about it. The axis is
**scored separately, with its own floor and ceiling** — never folded into the within-tolerance count,
because the owner's accuracy threshold is named against the 0-of-50 to 50-of-50 scale and a new axis
that moved it would silently reprice a decided bet.

| Axis | Floor — answers with nothing | Ceiling — the corpus's own answers |
|---|---|---|
| due dates (chores only) | **0 of 25 exact**, 0 invented | **25 of 25 exact**, 0 invented |

A chore description is **exact** on this axis when every expected job was found carrying exactly the
right date — the right calendar date where the description states one, and *no date* where it does
not. A refusal or an unparseable answer on an answerable description is a date miss for the same
reason it is a tolerance miss: the denominator is what was answerable, never what was answered.

**A description stating no date expects no date.** Decided at #202's filing gate: extraction never
invents a date — the confirm form supplies one — so the corpus records the no-date outcome as an
explicit `null` per job, and a date returned for one of those is tallied by name as **invented**,
the trust-destroying direction.

**10 of the 25 answerable chore descriptions state a date** and fifteen do not, and the split is
load-bearing. The owner's verdict floor for this axis is **18 of 25** (a figure below it narrows the
bet rather than killing it), so an extractor that never returns a date scores the fifteen undated
descriptions and lands **under** the floor; were fewer than eight dated, the never-a-date strategy
would meet the floor without reading a single date — the same do-nothing-scores-well fault the
grader's negative control forced out of the minutes design. A test holds the bound.

### How a stated date is scored

The extractor returns the date **as the description states it** — `Tuesday`, `tomorrow`, `the 12th
of september`, `2026-09-18` — and never resolves a phrase to a calendar date itself: date arithmetic
is deterministic code's job, and asking a model to do it would put the corpus's hardest failure mode,
an invented fact, inside the field that exists to avoid one. The grader normalises the stated form
with `normalizeDueDate(stated, reference)` and compares the result to a hand-computed expectation.

Every expected date was computed by hand against **2026-08-26** (`DUE_REFERENCE`, a Wednesday — the
day the axis was decided). The normaliser's vocabulary is deliberately small and stated:

| Stated form | Example | Resolves to |
|---|---|---|
| ISO date | `2026-09-18` | itself, validated |
| weekday | `tuesday` | the next such day **on or after** the reference — said on a Tuesday, "Tuesday" means today |
| relative | `today`, `tonight`, `tomorrow` | the reference's own date, or the day after |
| bare day-and-month | `september 12`, `the 12th of september` | the next such date on or after the reference, year inferred |

Anything else — `next tuesday` included, since English does not agree on which Tuesday that names —
is **refused**, and the grader scores the refusal as a miss on this axis only: the minutes verdict
stands, because *got the time right* and *got the date right* are different failures with different
repairs. Everything is a string on both sides of the boundary; the reference may carry a time
(`2026-08-26T23:59`) and its **date part is read as the local calendar date**, never through a
`Date` round trip — at Pacific/Marquesas, the suite's pinned zone, one minute before local midnight
is already tomorrow morning in UTC, and a round trip would answer "tomorrow" differently at 23:59
than at noon.

**Entity matching is unchanged by this story**: case and surrounding whitespace only, no stemming,
no synonyms, no fuzzy distance. The date axis reads the entities the minutes axis matched, so its
strictness is inherited rather than re-decided.

## What the grader deliberately does not do

- **It does not match entity names loosely.** Case and surrounding whitespace only — no stemming, no
  synonyms, no edit distance. A matcher generous enough to pair `Bathroom` with `Clean the bathroom`
  cannot tell *found the right jobs* from *found some jobs*, and that distinction is the whole
  purpose of the attribution counts. The expected title is the verb phrase the description itself
  contains, so a strict match is a fair test rather than a trick.
- **It does not throw on an answer it cannot parse.** #56 AC 3 requires an unparseable provider
  response to map to a distinct stated failure; a grader that throws on first contact with a real
  model gives its caller no way to report one. Junk, a wrong-kind answer, a duplicated entity and an
  extractor that throws all land in one named `malformed` count.
- **It does not read anything outside the description.** The extractor is handed `{ kind, text }`
  and nothing else — exactly what a real endpoint receives, so #56 implements this contract rather
  than a convenient variant of it, and the grader cannot leak an expected answer into the thing it is
  grading. The positive control is built by *closing over* the corpus instead.

## Placeholder names — AC 2

Every person in the corpus is `Alex`, `Robin` or `Sam`, which `src/test/gate.test.js` already
declares and which the owner audited against the real household on 2026-08-20. **This story
introduces no new given name**, because that audit is an observation no assertion in this repo can
make.

`gate.test.js`'s scan is necessary and not sufficient here, and the gap is structural. Its shape test
matches a literal only when the *whole* literal is name-shaped, so it sees `'Alex'` as an object key
and is blind to a name inside a sentence — and this corpus is nothing but sentences. Two things close
that:

- **Every description is written in lower case except the cast names and the weekdays.** A
  capitalised word in a description is therefore a name candidate by construction, and a test asserts
  every one of them is in one of those two vocabularies. There is no allowlist to go stale, because
  there is nothing else capitalised to allow. It also makes the corpus *harder*: a phone text box is
  exactly where people type without capitals, and an extractor leaning on capitalisation to find the
  people will fail on real input.
- **The scan population was widened.** `gate.test.js` named `src/lib/allocation.corpus.js` as a
  one-off exception; it now matches every `src/lib/*.corpus.js`. A check whose population does not
  contain the file being added is a check that answers about somebody else's work.

The cast **varies between descriptions** — some name one person, some two, some all three, one names
nobody. Without that the misattributed count would measure nothing: an extractor that ignored the
text and always answered with all three would have a clean attribution sheet on every item.

**The criterion's stated reason has expired and the criterion has not.** AC 2 reads *"because #19 is
open"*; #19 closed on 2026-08-21 when #121 gated previews behind a custom domain. `gate.test.js`
records why that does not retire the guard — a name in version control is exposed to everyone with
repository access, to every future reader, and to whatever the hosting arrangement happens to be on
the day.

## What this corpus cannot tell you

Stated rather than left for someone to discover:

- **Three names is a small cast.** A real household has names this corpus has never seen, and an
  extractor that happens to know these three tells you nothing about a fourth.
- **No assertion here can tell a real name from a plausible one.** That is `gate.test.js`'s own
  stated limit and it applies unchanged; the vocabulary converts *somebody committed a real name*
  into *somebody added a name to a list, in a diff, where a human can see it*, and no further.
- **The descriptions are written, not collected.** They are one person's model of how a household
  would describe its week. A corpus of real messages would be a better instrument and would carry
  exactly the data #19 exists to keep out of this repo, which is why it is not one.
- **The ceiling is circular by construction.** It bounds the scale; it is not evidence that the
  expected values are right. What makes those trustworthy is that they were written by hand, in a
  diff, each with a stated reason — not that a control agrees with them.
