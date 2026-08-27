# The extraction corpus, and what it measures

- Story: #42 — score plain-language capacity extraction against a fixed corpus
- Command: `npm run extraction:corpus`
- Corpus: [`src/lib/extraction.corpus.js`](../src/lib/extraction.corpus.js)
- Grader: [`src/lib/extraction.js`](../src/lib/extraction.js)

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
