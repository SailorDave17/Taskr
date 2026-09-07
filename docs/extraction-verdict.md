# The extraction bet — the verdict — #207

- Story: #207 — take the bet's verdict against real-member sentences and the manual floor
- Epic: #217 — the extraction bet: measure it, then build it or kill it
- Command: `npm run extraction:verdict`
- Inputs: [`extraction-run-2026-08-31.transcript.json`](extraction-run-2026-08-31.transcript.json)
  (#206), [`phone-latency-2026-09-07.tsv`](phone-latency-2026-09-07.tsv) (#205), and a member-sentence
  run (#207, below)
- Kill conditions: [`src/lib/extractionThresholds.js`](../src/lib/extractionThresholds.js) — the one
  place the owner's five numbers are written

**Every figure on this page re-derives from an artefact committed in this repository.** Nothing here
is quoted from another document's prose: the command reads #206's transcript and #205's raw rows and
recomputes, and `scripts/extraction-verdict.test.js` asserts the results against the figures those two
stories recorded before this code existed. Where the two disagree, the command wins and the
disagreement is a defect.

## What this decides, and what it cannot

The charter names one deliberate bet — *"AI-assisted setup and capacity capture. Describe your week in
plain language instead of filling in per-member minute budgets and capability matrices"* — and names
what kills it: *"latency, cost, or an LLM failure in the one flow that must never break; or extraction
that is wrong often enough to erode trust in the numbers the fairness claim rests on."*

Epic #217 turned that into five numbers, named by the owner on 2026-08-26 **before any measurement**.
Four of them had figures by the end of #206. This story takes the fifth — the correction rate — and
combines the two halves of the latency axis that no single story could measure.

## The deployed-path latency is an ESTIMATE — AC 3

**Neither input story can print this number, and that is not a gap in either of them.** #205 timed a
phone to `provision-member`, a function that does nothing but refuse; #206 timed a developer machine
to the provider. The kill number is named on the *deployed path*, which is both legs inside one
request — and no such request has ever been made, because the extraction endpoint (#208) does not
exist yet.

So the figure below is **computed from two measurements, not taken from one**, and the report labels
it so: `extractionThresholds.js` returns it as an estimate, the axis line prints `(est.)` with its
reason, and a pass over it is reported as **provisionally cleared** rather than as a pass.

### Why the arithmetic is not innocent

**The sum of two p95s is not the p95 of the sum.** Under independence it *overstates* — both legs
landing in their own slowest 5% at the same moment is rarer than one leg doing it — which is the
conservative direction, and the right way for a kill number to be wrong. Under positive correlation
(a degraded link slows the transport and the provider call together) it can understate. Nothing here
measures that correlation and nothing can until the two legs share a request.

### The transport, re-derived from #205's committed rows

"Warm, fresh socket" is the `warm` phase plus each pass's opening `first-after-idle` call — the
connection is new in both, the isolate is warm — which is how #205's own table reaches n=64 per
network.

| network | n | p50 | p95 | worst cold (n=3) |
|---|---|---|---|---|
| wifi | 64 | 479 ms | **967 ms** | 1,397 ms |
| cellular | 64 | 430 ms | **586 ms** | 797 ms |

**No p95 is quoted for the cold rows.** There are three per network, and at n=3 the nearest-rank p95
*is* the maximum — a distribution's name on the worst thing that happened. #205 reports maxima for
that reason and so does this.

### The combination

| transport | + `claude-opus-5` low (3,060 ms) | + `claude-haiku-4-5` (1,659 ms) |
|---|---|---|
| wifi, warm p95 (967) | 4,027 ms — **over** | **2,626 ms — under** |
| cellular, warm p95 (586) | 3,646 ms — **over** | **2,245 ms — under** |
| wifi, worst cold (1,397) | 4,457 ms — **over** | 3,056 ms — over, by 1.9% |
| cellular, worst cold (797) | 3,857 ms — **over** | **2,456 ms — under** |

The headline sheet is taken at **967 ms**, the worse of the two networks' warm p95s. That is chosen by
comparison and not by assumption: #205's finding was that **cellular beat wifi on every percentile**,
so a reading that assumed cellular was the pessimistic case would have taken the kill number at the
friendlier condition.

### What this says

- **`claude-opus-5` at effort low fails the latency kill number on every condition measured**, by
  646 to 1,457 ms. For that failure to be an artefact of the arithmetic, the true p95 of the sum
  would have to sit 16–33% below the sum of the p95s. Possible; not likely enough to build on.
- **`claude-haiku-4-5` clears it warm on both networks**, at 75–82% of the budget, and lands 1.9%
  over on the single worst cold wifi sample — which is *inside* this estimate's own error and is
  reported as marginal rather than as a failure.
- The axis therefore **selects a configuration** rather than killing or clearing the bet. That is a
  narrowing, and #206's figures say the narrowing is nearly free: Haiku scored 43 of 50 against
  Opus's 44, and *"two points apart is not a difference"* on a corpus graded once.

### What would settle it

#209 deploys the extraction endpoint. Timing that endpoint end to end from a phone replaces this
estimate with a measurement, and until it does, the latency axis carries `(est.)` everywhere it is
printed. Two directions of error are known and neither is measured here: that isolate will be larger
than `provision-member` and may boot slower, and the correlation between the two legs is unknown.

## The manual floor — AC 4

#52 measured the manual path on production, on the owner's real phone: a household from nothing to a
first fair split in **7 min 34 s**, across 4 in-app screens and ~88 interactions. That figure is a
**mechanical floor** — the run was driven over Chrome DevTools, so no reading, thinking or
phone-keyboard typing is in it.

### What the bet actually replaces

Read off #52's committed timeline:

| segment | elapsed | does the bet touch it? |
|---|---|---|
| signup, email confirmation, household creation (0:00–2:11) | 131 s | no |
| members and capacities (2:11–3:16) | 65 s | **capacity capture** (#210) |
| 13 chores, batch entry (3:16–4:58) | 102 s | **chore capture** (#213) |
| can't-do exclusions (4:58–5:53) | 55 s | no |
| reading the Split tab (5:53–6:11) | 18 s | no |
| hand-assigning 13 chores (6:11–7:34) | 83 s | no — that is #284 |

**The bet addresses 167 s of the 454 s floor — 37% of the elapsed time.**

The interaction counts matter more than the seconds, and #52 records them exactly for only two steps:
the chore step is **54 of the ~88** total (13 names + 13 minutes + 13 due dates + 11 add-row taps + 2
submits + 2 mode taps) and the assignment step is 13. So **the single step the bet replaces carries
61% of the run's interactions while costing 22% of its elapsed time** — and the elapsed figure is a
*mechanical* floor, driven over DevTools with no human reading or phone-keyboard typing in it. Those
54 interactions are exactly where the missing human time would land. #52's own reading was that
tripling the floor puts a careful person at 20–25 minutes, and the tripling falls hardest there.

*(The per-step interaction counts for the other segments are not recorded on #52 and are not
estimated here; ~88 is that story's total.)*

Against that, the extraction path costs one sentence typed, one round trip of an estimated 2.2–2.6 s
on the surviving configuration, and a confirm.

### How much faster — the comparison AC 4 actually asks for

The criterion asks the verdict to state *how much faster the extraction path reached a usable figure
than the manual path did*, and it has to be answered as a **bound** rather than a ratio, because the
human half is unmeasured on both sides.

| | manual, on the segment the bet replaces | extraction |
|---|---|---|
| measured | **167 s** mechanical, across 62 of ~88 interactions | **2.2–2.6 s** — one round trip, estimated |
| unmeasured | human reading and typing, which #52 says is most of it | typing one sentence, reading the proposal, confirming |

**So the honest statement is a floor, not a speed-up: the bet's measured component is 1.6% of the
segment it replaces.** Everything else on both sides is human time nobody has timed. The manual side's
167 s excludes phone-keyboard typing for 13 chore names, 13 durations and 13 due dates; the extraction
side's 2.6 s excludes composing one sentence and confirming a proposal.

What can be said without an unmeasured quantity: **the manual path requires 54 interactions to enter
13 chores and the extraction path requires one sentence and a confirm**, and that ratio — not the
seconds — is where the acceleration lives. A real comparison needs #52's protocol re-run by a human
against a working capture flow, which does not exist until #213. This document does not claim a
speed-up figure, and no other document should quote one from it.

### Accelerator or load-bearing

**Accelerator.** This is not re-derived here — the owner recorded it on #52 as that story's AC 2:
*"meets ambition 2 — the bet is an accelerator, not load-bearing."* Ambition 2 is *"being set up is
not a project: a household reaches useful in one sitting, without an evening of data entry"*, and the
manual path reaches a fair split in one sitting without the bet.

The charter's fallback rule is satisfied on its own terms: *"the manual path must exist and work on
day one; the bet is an accelerator on top of it, never the only road in."* It exists, it works, and a
stop verdict on the bet costs speed rather than the product.

**The honest half.** #52's headline finding was not the time. It was stall 3 — with every member,
capacity, chore and exclusion entered, the Split tab read *"the split is level"* over *"375 min of
work nobody has yet"* and **offered no control at all**. The bet does not fix that, and would not
have: extraction proposes chores and capacities, and the thing that was missing was an allocate
affordance. That is #284. A verdict that read the bet as the answer to #52's setup experience would
be reading the wrong stall.

## The correction rate — AC 1 and AC 2

Collected 2026-09-07 from the owner — a real household member who wrote neither the extractor, its
prompt, nor the corpus, which is the exclusion AC 1 names. **35 distinct sentences: 25 about chores
and 10 about capacity.** They ran as 45 extraction inputs, because the ten capacity sentences were
run twice under different framings (below), through both configurations — 90 metered calls.

The record is committed: [`extraction-members-2026-09-07.json`](extraction-members-2026-09-07.json)
(the sentences), `.transcript.json` (every response, both configurations) and `.review.json` (the
owner's corrections). Real given names are replaced by the corpus cast — the owner is `Alex`, the
second member `Robin` — and **two sentences describing the owner's child are withheld entirely**
(owner decision, 2026-09-07): a placeholder name does not make a real child's bedtime fit to publish.
Their *tallies* are recorded in the JSON even though their text is not, so every figure below still
re-derives. `scripts/extraction-members.test.js` replays the committed pair and asserts it closes to
exactly these numbers.

### How the sentences were collected, which is itself a result

They arrived in four batches, and the batches are not interchangeable:

| batch | n | how it was asked | provenance |
|---|---|---|---|
| recurring chores | 12 | written cold, against a brief explicitly asking how long each job takes | `cold` |
| chore durations | 9 | written after the session told the owner durations were missing | `coached` |
| one-off chores | 4 | unprompted, alongside the above | `one-off` |
| capacity | 10 | each one the answer to a direct question the session asked | `prompted` |

**Twelve of twelve cold sentences described how *often* a chore recurs and none described how long it
takes** — against a brief that asked for the duration. The four one-off chores, written unprompted in
the same session, inverted it exactly: **four of four gave a duration and none gave a cadence.** A
recurring chore is described by its rhythm and a one-off by its cost, and nothing in this repository
had recorded that.

The capacity batch is the sharper result. Asked three times, in three framings, for a description of a
person's available time, the owner produced **25 chore sentences and none about capacity**. Asked a
direct question — *"how much time have you got for chores this week?"* — the answer came back
immediately and quantified, for both members. **The capacity language exists; it is never volunteered.**
A free-text "describe your week" box would have collected nothing from this household three times
running. That is a finding about the capture surface, not about the model, and it is the strongest
practical result in this document.

### How the rate is defined, and the denominator that decides it

The obvious denominator — figures the extractor **proposed** — scores an extractor that proposes
nothing at a perfect 0%: it never put a wrong figure in front of anybody, so nothing it did was
corrected. It would clear a 30% kill number by refusing every sentence, on the axis that exists to
measure trust.

That is the same fault [`extraction-corpus.md`](extraction-corpus.md) records the minutes grader being
built around — *"grade tolerance on matched entities alone and the do-nothing extractor scores a
perfect 100%"* — arriving in a different axis. So the denominator is every figure the member **had to
deal with**:

    proposed figures  +  figures the member had to supply themselves

and the numerator is every correction, of any class. A refusal on a sentence naming three people reads
3 of 3 — 100% — because the member typed all three by hand. A flawless extraction of the same sentence
reads 0 of 3. Both ends are asserted as controls in `src/lib/memberCorrections.test.js`, and they are
the reason to believe any figure between them.

A **figure** is one person's minutes, one chore's minutes, or one chore's due date. A date the
extractor correctly omitted is not a figure: counting it would inflate every denominator by the number
of chores it was right to leave undated.

### The five classes — AC 2

Recorded per correction, because *"those five damage trust differently and a single correction count
cannot distinguish them"*:

| class | what it is |
|---|---|
| wrong number | right person or job, wrong minutes |
| missed entity | a person or job the member named and the extractor did not return |
| invented entity | a person or job the extractor returned and the member never named |
| wrong date | right job, wrong or invented due date |
| refusal | the extractor declined a sentence the member thinks it should have answered |

### What the owner ruled, and why the rulings matter more than the rate

The ground truth here is a person's judgement, so the rulings are recorded as decisions rather than
folded silently into a number. Five were taken, each at a clickable question:

1. **A chore returned at `0` minutes, where the sentence stated no duration, is NOT a correction** —
   it is an honest blank the confirm form fills in. Seven chores.
2. **A cadence in the `dueDate` field IS a correction**, class *wrong date*. Six chores.
3. **`I` returned as a person IS a correction**, class *missed entity*. Two inputs.
4. **A dropped assignee is NOT a correction** — the contract has no field for it, so it is recorded
   as a contract gap instead. Six chores.
5. **Two refusals ARE corrections**: one unparseable response, and one refusal where a duration was
   derivable from the sentence.

**Ruling 1 is load-bearing for the entire chore verdict, and it carries a condition.** Had those
seven `0` figures counted, chores would read **55.6%** rather than 29.6% — a catastrophic failure
instead of a pass. The ruling holds only if a member never has to treat that `0` as a number they
proposed.

**Half of that is already enforced, and knowing which half matters.** The *store* cannot hold it:
`src/lib/chores.js` refuses expected minutes below `MIN_EXPECTED_MINUTES = 1` with the reasoning in
its docblock, and `chores_expected_minutes_range` checks `between 1 and 1440` in the schema — so a
zero-minute chore cannot be written, deliberately, and has not been able to since `0003`. What has no
such distinction is the **extraction contract**: the model returned `0` and nothing between it and the
confirm form says whether that means *no duration given* or *this takes no time*. So the residual is
**presentational** — the capture surface must render that `0` as an empty field rather than as a value
to accept — and it is a requirement on #213, not on the data model.

*(An earlier version of this paragraph called it "a hard requirement on #210 and #213" and said
nothing in the contract distinguishes the two cases. Both overstated what is owed: the schema had
already closed the storage half. Found by a review fan-out, 2026-09-07.)*

### The result — claude-haiku-4-5

| scope | corrections | figures | rate | vs <= 30% |
|---|---|---|---|---|
| capacity | 1 | 3 | **33.3%** | **FAIL** |
| chores | 8 | 27 | **29.6%** | PASS |
| all | 9 | 30 | **30.0%** | PASS, exactly |

By class: *wrong date* 6, *missed entity* 1, *refusal* 2. **Reviewed on `claude-haiku-4-5` only** —
the configuration the latency axis leaves standing. Opus's 45 answers are in the committed transcript
and can be scored later without re-spending; it has no correction rate here and its rows read *not
measured* rather than being filled in from Haiku's.

**Each capacity sentence is counted once, not once per framing arm.** The ten capacity sentences were
run in two framings (below), and a first version of this document scored both arms into one rate —
counting the same member language twice. That put `all` at 10 of 33, **30.3%**, and reported the axis
as failing. It is 9 of 30. The arm contributed no information to the flip: both framings produced
identical outcomes. Caught by this story's own review fan-out, 2026-09-07, and the shape is
`a-fixture-cannot-tell-a-sort-from-its-tie-break`'s cousin — an experiment arm that answers no
question still moves a denominator.

**Read these numbers with their denominators in view, because they are small.** Capacity is **one
correction out of three figures**: one more would be 66.7%, one fewer 0%. The run-level figure lands
**exactly on the ceiling** — 9/30 is 0.3, and `0.3 <= 0.3` — so it passes by nothing at all. A test
asserts that equality rather than assuming it, because a different route to the same rational could
produce `0.30000000000000004` and flip the axis while every printed figure still read *30.0%*.

### The pooled figure is a mixture, and the parts disagree — read this before quoting 29.6%

The chore sentences were collected in three batches, and only one of them was written without any
knowledge of what the extractor wants. Scored separately:

| provenance | sentences | corrections | figures | rate |
|---|---|---|---|---|
| **cold** — written before any feedback | 11 | 7 | 14 | **50.0%** |
| coached — written after the session named the missing duration field | 8 | 0 | 8 | 0.0% |
| one-off — unprompted, naturally carrying a duration | 4 | 0 | 4 | 0.0% |
| **pooled, as the axis is scored** | 23 | 8 | 27 | **29.6%** |

**Against the eleven chore sentences the household produced cold, half the figures needed fixing.**
The pooled 29.6% clears the ceiling because twelve zero-correction sentences are averaged in with the
twelve written blind — and eight of those twelve exist *because* the session said durations were
missing. That is not a reason to distrust them as member language; the owner wrote all 35 and naming
a gap is not authoring a sentence. It is a reason not to read the pooled figure as the bet's score
against language nobody shaped.

**What keeps this from overturning the verdict is which corrections they are.** Six of the seven cold
corrections are a cadence landing in the due-date field — the single missing `recurrence` slot — and
the verdict below already makes that field a precondition of chore capture proceeding. The seventh is
one unparseable response. So the 50% is best read as **the size of the recurrence gap**, measured, and
it is evidence *for* the condition rather than against the narrow.

*(This table was absent from the first two versions of this document, which reported the cold /
coached / one-off split as a finding about how people describe chores and never scored the batches
separately. A review fan-out found it on the second pass.)*

**No verdict should rest on arithmetic this fine, and the one below does not.**

### What actually went wrong, which is not what the rate says

**23 of 45 inputs answered, 22 refused, 1 unparseable.** Split by what the sentence contained:

- **Where a duration was stated, extraction was near-perfect: 12 of 13**, including "6 hours" → 360.
- **Where it was not, the failure mode was inconsistent and dangerous.** On the twelve cold
  sentences it returned `0` minutes seven times and refused four others *for the same stated reason*.
  A chore stored at 0 minutes is **free work**: it enters the split costing nobody anything, so the
  split reads level while one person does all of it. That is the charter's *"wrong often enough to
  erode trust in the numbers the fairness claim rests on"*, in its most damaging available form.
- **Five of those seven also put a cadence in the due-date field** — `due "every week"` — which
  `normalizeDueDate` cannot parse at all. A sixth collapsed *"every week on thursday"* to a single
  Thursday, silently dropping the recurrence while looking correct.

### The framing experiment, and the fix it refuses

The ten capacity sentences were run twice: as the app sends them (text alone) and with the question
that drew them prepended. **The outcomes were identical** — the same two answered, the same eight
refused. The hypothesis that a prompted capture needs its prompt attached is **refused by
measurement**.

The reason is visible in the one sentence whose refusal *reason* differed. `"maybe 5 hours"` bare was
refused for hedging; with the question attached it was refused because *"the message does not name a
specific person, only refers to 'you'"*. And the same gap appears in the two **successes**: `cap-1`
came back as **`I: 480 min`** — an entity no roster row matches, in both arms.

**The missing thing is not the question. It is who is speaking**, and the contract has no field for it.

### Three contract gaps, which caused most of the damage

Recorded as findings rather than corrections (rulings 2 and 4), because no model could have supplied
what the schema cannot hold:

| gap | evidence | who owns it |
|---|---|---|
| **recurrence** | 12 of 12 cold sentences; `repeat_kind`/`repeat_weekdays` have existed since migration `0012` | #208, #213 |
| **assignee** | 6 of 25 chore sentences named a person; the app has per-chore assignment | #208, #213 |
| **speaker identity** | `I: 480 min`; the `cap-6` refusal in both arms | #208, #210 |

These are additions to a schema, not a different model or a revised prompt.

## The kill-condition sheet

Reproduce with `npm run extraction:verdict -- --members … --members-transcript … --sheet …`.

    CONFIGURATION claude-haiku-4-5
      capacity
        within tolerance            20 of 25      PASS          threshold >= 18 of 25
        ambiguous refused           5 of 5        PASS          threshold >= 4 of 5
        overconfident               0 of 5        PASS          threshold <= 1 of 5
        correction rate             33.3%         FAIL          threshold <= 30%
        verdict                     FAILS on correctionRate
      chores
        within tolerance            23 of 25      PASS          threshold >= 18 of 25
        ambiguous refused           5 of 5        PASS          threshold >= 4 of 5
        overconfident               0 of 5        PASS          threshold <= 1 of 5
        due dates exact             21 of 25      PASS          threshold >= 18 of 25
        correction rate             29.6%         PASS          threshold <= 30%
        verdict                     clears every axis with a figure
      all
        within tolerance            43 of 50      PASS          threshold >= 35 of 50
        ambiguous refused           10 of 10      PASS          threshold >= 7 of 10
        overconfident               0 of 10       PASS          threshold <= 2 of 10
        due dates exact             21 of 25      PASS          threshold >= 18 of 25
        p95, deployed path          2626 ms       PASS (est.)   threshold <= 3000 ms
        cost per household per year $0.03         PASS          threshold <= $5.00
        correction rate             30.0%         PASS          threshold <= 30%
        verdict                     clears every axis with a figure · PROVISIONALLY on latency

`claude-opus-5` at effort low **FAILS on latency** at every condition measured (3,646–4,457 ms), and
clears every other axis that has a figure.

**Every axis measured against the corpus passes on both configurations. The one failure in the whole
sheet is capacity's correction rate — the axis measured against real language rather than against
sentences written for the extractor, at the kind that turned out to have almost no usable language in
it.** That is the single most useful sentence in this document, and it is what #207 was filed to
produce.

### The correction rate is taken per kind, and this run is why

`extractionThresholds.js` grouped the correction rate with latency and cost as *"named at the run
level, with no per-kind meaning"* until this measurement. It has one: its unit is a **figure**, and
every figure belongs to exactly one kind — and the two halves came apart on either side of the kill
number. A run-level-only rate would have reported one figure over both and hidden exactly the split
epic #217 exists to express. The per-kind threshold is the owner's own 30% unchanged, because their
stated derivation rule is *"the same rate applied to each half"* and 30% is already a rate.

## The verdict — AC 5

**NARROW.** Recorded by the owner, 2026-09-07, per input kind:

| kind | verdict |
|---|---|
| **chores** | **PROCEED**, on `claude-haiku-4-5`, conditional — see below |
| **capacity** | **HOLD**. Not proceed, and not stop |

**Chore capture proceeds**, and the conditions are part of the verdict rather than commentary:

1. The contract gains **recurrence** and **assignee**, or the capture path throws away what members
   actually say. Twelve of twelve cold sentences carried a cadence.
2. The capture surface renders `expectedMinutes: 0` as an **empty field** rather than as a value to
   accept. Ruling 1 is what puts the chore rate at 29.6% instead of 55.6%, and this is its
   precondition. The storage half is already closed — the schema refuses zero — so this is a
   presentation requirement on #213 alone.
3. The configuration is `claude-haiku-4-5`. Opus fails the deployed-path budget on every condition
   measured, and the accuracy difference between them — 43 of 50 against 44 — is inside the noise of
   a corpus graded once.

**Capacity capture holds.** Its 33.3% rests on **one correction out of three figures**, which is not a
measurement anyone should stop a bet on, and equally not one to build on. What the run *did* establish
about capacity is not a rate at all:

- Only **2 of 10** capacity sentences carried a usable quantity — against a corpus that is 83%
  answerable. The instrument that cleared four kill numbers was built on input four times more
  answerable than the real thing.
- The two that worked existed **only because a direct question was asked**, and one of them still
  returned an unresolvable `I`.

So capacity is held pending either a real measurement of the capture flow with a prompted surface and
a speaker field, or a decision to route capacity to the calendar-derived path (#96, #97, #98, #106),
which infers availability rather than asking for it. **That decision is not taken here**, because
this run does not contain the evidence to take it.

### Which axes cleared, and which did not

| axis | capacity | chores | all |
|---|---|---|---|
| within tolerance | PASS | PASS | PASS |
| ambiguous refused | PASS | PASS | PASS |
| overconfident | PASS | PASS | PASS |
| due dates exact | — | PASS | PASS |
| deployed p95 | — | — | **PROVISIONAL** (estimate) |
| cost | — | — | PASS |
| correction rate | **FAIL** | PASS | PASS, exactly on the ceiling |

### The argument against this verdict, stated rather than buried

The five kill numbers were fixed on 2026-08-26 **before any measurement**, precisely so they would be
honoured instead of argued with afterwards. One of them failed, at capacity. Every reason offered
here for holding rather than stopping — a denominator of three, an instrument the threshold was not
set against — was equally available before the run, and would have been rejected then.

Two things answer it, and neither is "the number is close".

**The failure is concentrated where the evidence is thinnest, and the run says why.** Only 2 of 10
capacity sentences carried a usable quantity at all, so the axis has three figures to work with. A
kill number is a claim about a rate, and a rate over three figures moves 33 points per correction.
Holding is what you do with an instrument that cannot resolve the question; stopping on it would be
treating an absence of evidence as evidence.

**The chore failures are schema gaps, not accuracy.** Six of the eight chore corrections are one
missing field — a recurrence the contract cannot hold — and those are additions rather than
redesigns. A stop verdict would discard roughly six days of unbuilt work (#208–#214) on the strength
of a field nobody has added yet.

**The narrow is recorded as a judgement, not as arithmetic, and this paragraph is why.** The
arithmetic changed once already: a first version of this document double-counted the framing
experiment and reported the run-level axis as failing at 30.3%. Had the verdict been taken from the
number, it would have been taken from a wrong one — and it would have come out the same, which is the
argument for not taking verdicts from numbers this fine.

## AC 6 — the stop clause

Moot under this issue's own terms. AC 6 requires a stop verdict to name the stories it deletes and
close them as not-planned in the same pass; the verdict is a narrow, so nothing is deleted and no
issue is closed as not-planned by it.

## AC 7 — what the narrow keeps, named

*"A narrow with no stated scope is a proceed nobody has to defend."* So, explicitly:

- **The capture path that survives is chore capture** (#213), on `claude-haiku-4-5`, through the
  endpoint #208 stands up — with the contract widened by recurrence and assignee first.
- **The axis that survives is accuracy on stated quantities.** Where a member states a duration, the
  extraction was right 12 times in 13. That is the thing worth building on, and it is narrower than
  "extraction works": it does not extend to inferring a quantity nobody stated, which is where every
  observed failure came from.
- **What does not survive is unprompted free-text capture.** A blank "describe your week" box
  collected nothing from this household in three attempts. Any capture surface that ships must ask a
  direct question.
- **What is neither kept nor discarded is capacity capture** (#210), held as above.

## What this verdict does not settle

- **One run, one day, one household.** No figure here has a confidence interval, and the member
  sentences come from a household of two.
- **The deployed path is still an estimate.** #209 replaces it with a measurement.
- **The correction rate is measured on a review, not on the flow.** The member judged extractions
  from sentences they wrote; nobody has yet corrected a figure inside the capture flow with the
  confirm form in front of them, because that flow (#210, #213) is what the verdict decides.
- **The prompt is unfitted and stays that way.** `extractionAdapter.js` has one commit. Any figure
  here would move — in either direction — under a revised prompt, and revising it against these
  sentences would make the next measurement circular.
