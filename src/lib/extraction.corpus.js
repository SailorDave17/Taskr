// The extraction corpus — #42 AC 1 and AC 2.
//
// Sixty plain-language descriptions, thirty of each input kind, and EVERY
// expected value below was worked out by hand before any extractor was run
// against it. That is AC 1, and it is the same rule the allocation corpus
// states for the same reason: a corpus whose expectations were produced by
// calling the thing under test asserts only that the thing still does what it
// did, which is what a regression suite gets for free and the one thing an
// accuracy claim cannot rest on.
//
// TWO KINDS, BECAUSE THE BET COVERS TWO
//
// The issue body scopes this corpus to "plain-language week descriptions". The
// charter's 2026-08-08 widening put chore capture inside the bet and said so in
// as many words: "#42's corpus was scoped to capacity descriptions only. A bet
// that covers chore capture needs chore descriptions in the same corpus, scored
// by the same grader, or the measurement that decides whether the bet survives
// is silent about half of what it now claims." Owner decision at pickup, 2026-08-25:
// both kinds, thirty each. A capacity description yields minutes attributed to
// named people; a chore description yields a job and how long it takes. An
// extractor can plausibly be good at one and bad at the other, which is why the
// grader reports them separately rather than as one headline.
//
// WHY THE PROSE IS LOWER CASE — AC 2
//
// Every description is written in lower case EXCEPT the cast names and the
// weekday names. That is not a style preference, it is what makes AC 2
// checkable on prose at all.
//
// `src/test/gate.test.js` scans fixtures for name-shaped literals, and its
// SHAPE scan matches a literal only when the WHOLE literal is name-shaped — so
// a name buried in a sentence is invisible to it by construction. A corpus
// whose content IS sentences would therefore be scanned and pass while saying
// anything at all. Holding the prose to lower case inverts that: a capitalised
// word in this file's descriptions is a name candidate and nothing else, and
// `extraction.test.js` asserts every one of them is a member of `CAST` or a
// weekday. There is no allowlist to go stale, because there is nothing else
// capitalised to allow.
//
// It also makes the corpus HARDER rather than easier. A phone text box is
// exactly where people type without capitals, and an extractor that leans on
// capitalisation to find the people is one that will fail on real input.
//
// WHY THE CAST IS THREE NAMES AND NO MORE
//
// `Alex`, `Robin` and `Sam` are already declared in gate.test.js and were
// audited against the real household by the owner on 2026-08-20 — an
// OBSERVATION, which no assertion in this repo can make. Introducing a fourth
// given name would need that audit again, so this corpus introduces none. The
// cost is stated rather than hidden: three names is a small cast.
//
// The compensating design is that the CAST VARIES PER DESCRIPTION — some name
// one person, some two, some all three, one names nobody. Without that, an
// extractor that ignored the text and always answered with all three would
// score a clean attribution sheet against every item, and the misattributed
// count AC 3 asks for would measure nothing.
//
// WHY THE EXPECTED KEYS ARE QUOTED
//
// `{ 'Alex': 300 }` rather than `{ Alex: 300 }`, deliberately. The #19 SHAPE
// scan reads quoted string literals; a bare object key is not one, so writing
// these unquoted would put every person this corpus names outside the guard
// that exists to look at them. The quotes are what make the vocabulary check
// reach this file.
//
// AMBIGUOUS ITEMS CARRY A REASON, NOT AN ANSWER
//
// AC 1's other half. Ten descriptions here are genuinely undecidable — they
// name no quantity, or refer to a baseline the text does not contain, or offer
// two answers an order of magnitude apart. Each carries `ambiguous` with the
// reason instead of an invented expected value, and AC 6 is why that matters:
// an extractor that answers one of these with a confident number is counted
// separately from one that is merely wide, because the charter's kill condition
// is trust and those two damage it differently.

/**
 * Every person this corpus names. Closed on purpose — `extraction.test.js`
 * asserts no expected capacity map names anybody outside it.
 */
export const CAST = Object.freeze(['Alex', 'Robin', 'Sam'])

/** The only other words permitted to carry a capital in a description. */
export const WEEKDAY_WORDS = Object.freeze([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
])

/**
 * Thirty descriptions of a household week, each yielding minutes per person.
 *
 * `toleranceMinutes` is per description and is a bound on the error for ANY ONE
 * person, not on the total: three people each fifteen minutes out is three
 * failures, not one that happens to sum badly. Zero where the description
 * states a number outright; wider where it hedges, and the width is read off
 * the hedge — "about" and "a couple" buy fifteen to thirty minutes, an explicit
 * range buys half the range.
 */
const CAPACITY = [
  {
    text: 'Alex has five hours this week and Robin has three.',
    why: 'the plainest possible case. Two people, whole hours, stated outright — if this one is wrong nothing further is worth measuring.',
    expect: { minutesByEntity: { 'Alex': 300, 'Robin': 180 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin can manage two hours and thirty minutes, and Sam has forty-five minutes.',
    why: 'mixed units in one sentence, and a value under an hour. An extractor that reads only the hours figure lands Robin on 120.',
    expect: { minutesByEntity: { 'Robin': 150, 'Sam': 45 }, toleranceMinutes: 0 },
  },
  {
    text: 'Sam only has half an hour this week.',
    why: 'a fraction written as words rather than digits, and a household of one named person.',
    expect: { minutesByEntity: { 'Sam': 30 }, toleranceMinutes: 0 },
  },
  {
    text: 'Alex has an hour on Monday, an hour on Wednesday and two hours on Saturday.',
    why: 'the total is never stated — it has to be summed from three days. 60 + 60 + 120.',
    expect: { minutesByEntity: { 'Alex': 240 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin has about half an hour each weekday and nothing at the weekend.',
    why: 'a rate over a named subset of days, which needs the reader to know a weekday count. Five thirties, and "about" is what buys the tolerance.',
    expect: { minutesByEntity: { 'Robin': 150 }, toleranceMinutes: 15 },
  },
  {
    text: 'Sam is away all week so nothing from Sam, and Alex has four hours.',
    why: 'an explicit zero. The person most at risk of being dropped from the answer entirely is the one with no time, and a missing person is a different failure from a wrong number.',
    expect: { minutesByEntity: { 'Sam': 0, 'Alex': 240 }, toleranceMinutes: 0 },
  },
  {
    text: 'Alex is off work this week and has ten hours.',
    why: 'one person, a large figure, and a clause about why that carries no minutes of its own.',
    expect: { minutesByEntity: { 'Alex': 600 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin has somewhere between two and three hours.',
    why: 'an explicit range. The midpoint is the answer and half the range is the tolerance, which is the rule this corpus applies to every range.',
    expect: { minutesByEntity: { 'Robin': 150 }, toleranceMinutes: 30 },
  },
  {
    text: 'Sam has a couple of hours and Alex has most of a day, say six hours.',
    why: 'two different hedges in one description. The tolerance is set by the looser of them rather than averaged, because a per-person bound is only useful if it holds for the worst person.',
    expect: { minutesByEntity: { 'Sam': 120, 'Alex': 360 }, toleranceMinutes: 30 },
  },
  {
    text: 'Alex has six hours. Robin has half that.',
    why: 'the second figure is relative to the first and to nothing outside the text, so it is answerable — unlike the ambiguous items below, where the anchor is missing.',
    expect: { minutesByEntity: { 'Alex': 360, 'Robin': 180 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin normally has four hours but loses two of them to a work trip.',
    why: 'arithmetic in the opposite direction. Both numbers are present and the answer is neither of them.',
    expect: { minutesByEntity: { 'Robin': 120 }, toleranceMinutes: 0 },
  },
  {
    text: 'Alex has three hours, Robin has ninety minutes, and Sam has none.',
    why: 'all three named, three different unit styles, and a zero at the end of a list where it is easiest to drop.',
    expect: { minutesByEntity: { 'Alex': 180, 'Robin': 90, 'Sam': 0 }, toleranceMinutes: 0 },
  },
  {
    text: 'Sam cannot do anything Monday or Tuesday, but has an hour on each of the other five days.',
    why: 'the days that count are the ones NOT named. An extractor that counts the weekdays it can see lands on two.',
    expect: { minutesByEntity: { 'Sam': 300 }, toleranceMinutes: 0 },
  },
  {
    text: 'Alex has two and a half hours, and Sam has an hour and a quarter.',
    why: 'fractional hours spelled in words, including a quarter, which is the one that most often rounds to zero or to thirty.',
    expect: { minutesByEntity: { 'Alex': 150, 'Sam': 75 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin is free most evenings.',
    why: 'AC 1 and AC 6. Names a person and no quantity of any kind — neither how many evenings nor how long one is. A number here is invented, not extracted.',
    ambiguous: 'names a person and no quantity: neither how many evenings nor how long each is',
  },
  {
    text: 'everyone is pretty busy this week.',
    why: 'the emptiest input the flow can receive. No person, no number, and the only honest answer is to ask.',
    ambiguous: 'names nobody and no quantity',
  },
  {
    text: 'Alex has a bit more time than usual this week.',
    why: 'relative to a baseline that lives in the database and not in the text. The nastiest of the ambiguous set, because it looks answerable and is only answerable to something holding the previous figure.',
    ambiguous: 'relative to a baseline the description does not state',
  },
  {
    text: 'Alex is on holiday all week — call it thirty hours.',
    why: 'a large figure with a hedge attached to it. Thirty hours is well inside the 10080-minute ceiling capacity.js enforces, and this is the item that would catch a clamp set too low.',
    expect: { minutesByEntity: { 'Alex': 1800 }, toleranceMinutes: 60 },
  },
  {
    text: 'Robin has two hours. Sam is at a conference and will not be around at all.',
    why: 'a zero stated without the word zero or the word none. The second sentence carries no digits at all.',
    expect: { minutesByEntity: { 'Robin': 120, 'Sam': 0 }, toleranceMinutes: 0 },
  },
  {
    text: 'Alex has thirty minutes on Monday, thirty on Tuesday, forty-five on Wednesday, nothing Thursday or Friday, two hours on Saturday and an hour on Sunday.',
    why: 'the longest arithmetic in the corpus — seven days, two of them zero, three unit styles. 30 + 30 + 45 + 0 + 0 + 120 + 60.',
    expect: { minutesByEntity: { 'Alex': 285 }, toleranceMinutes: 0 },
  },
  {
    text: 'Sam has 1.5 hours and Robin has 0.5.',
    why: 'decimals rather than words, and a bare decimal whose unit is only stated for the first person.',
    expect: { minutesByEntity: { 'Sam': 90, 'Robin': 30 }, toleranceMinutes: 0 },
  },
  {
    text: 'Alex has four hours, Robin has three, and Sam has one.',
    why: 'elision. Only the first figure carries its unit; the other two inherit it, and an extractor reading the bare numbers as minutes lands Robin on three.',
    expect: { minutesByEntity: { 'Alex': 240, 'Robin': 180, 'Sam': 60 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin has no more than an hour this week.',
    why: 'an upper bound rather than a quantity. The bound is the only figure available so it is the answer, and the tolerance says so rather than pretending the phrasing was exact.',
    expect: { minutesByEntity: { 'Robin': 60 }, toleranceMinutes: 15 },
  },
  {
    text: 'Alex has three hours, or maybe five, hard to say.',
    why: 'AC 6, and the case that separates ambiguous from merely hedged. The span is 120 minutes wide and the text explicitly declines to choose, so no tolerance this corpus would accept could cover it.',
    ambiguous: 'the description declines to choose between two figures 120 minutes apart',
  },
  {
    text: 'it is a write-off this week. Alex, Robin and Sam all have nothing.',
    why: 'every person at zero. The whole answer is zeros, which is byte-identical to the negative control extractor answering nothing at all — except that this one names three people and the control names none, which is exactly the distinction the attribution counts exist to make.',
    expect: { minutesByEntity: { 'Alex': 0, 'Robin': 0, 'Sam': 0 }, toleranceMinutes: 0 },
  },
  {
    text: 'Sam can do seven until eight each evening from Monday to Friday.',
    why: 'clock times rather than durations, over a named span of days. The duration has to be derived from the two times before it can be multiplied.',
    expect: { minutesByEntity: { 'Sam': 300 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin has forty-five minutes.',
    why: 'the shortest answerable description here, and the one that catches invention: an extractor with a fixed roster answers three people where the text names one, and the two extra land in the misattributed count.',
    expect: { minutesByEntity: { 'Robin': 45 }, toleranceMinutes: 0 },
  },
  {
    text: 'Sam has about the same as last week.',
    why: 'refers to a week this description does not contain. Same shape as the "more than usual" item and a different missing anchor, because both are worth having.',
    ambiguous: 'refers to a week the description does not contain',
  },
  {
    text: 'Alex works late Monday through Thursday so has nothing until Friday, then two hours on Friday and three on each weekend day.',
    why: 'a span of zeros stated as a reason rather than a number, and a weekend rate. 0 + 120 + 180 + 180.',
    expect: { minutesByEntity: { 'Alex': 480 }, toleranceMinutes: 0 },
  },
  {
    text: 'Robin has an hour a day every day, and Alex has twenty minutes a day on weekdays only.',
    why: 'two rates over two different day counts in one sentence — seven and five. An extractor applying one multiplier to both lands Alex on 140.',
    expect: { minutesByEntity: { 'Robin': 420, 'Alex': 100 }, toleranceMinutes: 0 },
  },
]

/**
 * Thirty descriptions of work to be done, each yielding jobs and their minutes.
 *
 * The entity here is the job's TITLE, so the same scoring rule covers both
 * kinds: an unattributed entry is a job the extractor missed, a misattributed
 * one is a job it invented. Titles are matched case-insensitively and
 * otherwise exactly — see `normalizeEntity` for why nothing fuzzier is used.
 * The expected title is the verb phrase the description itself contains, so a
 * strict match is a fair test rather than a trick.
 */
const CHORES = [
  {
    text: 'clean the bathroom, about half an hour.',
    why: 'the issue comment names this exact shape as the archetype: one job, one hedged duration, no person anywhere in it.',
    expect: { minutesByEntity: { 'Clean the bathroom': 30 }, toleranceMinutes: 10 },
  },
  {
    text: 'mow the lawn takes an hour.',
    why: 'the duration is phrased as a property of the job rather than appended to it, so the number is not where the previous item put it.',
    expect: { minutesByEntity: { 'Mow the lawn': 60 }, toleranceMinutes: 0 },
  },
  {
    text: 'take the bins out on Tuesday night, five minutes.',
    why: 'carries a day, which is due-date information rather than duration. An extractor that folds the day into the answer has added a field nobody asked for.',
    expect: { minutesByEntity: { 'Take the bins out': 5 }, toleranceMinutes: 0 },
  },
  {
    text: 'vacuum the downstairs, twenty minutes.',
    why: 'a plainly stated single job, held as a control on the harder ones around it.',
    expect: { minutesByEntity: { 'Vacuum the downstairs': 20 }, toleranceMinutes: 0 },
  },
  {
    text: 'change the bed sheets, fifteen minutes a bed and there are three beds.',
    why: 'one job whose duration is a product. Fifteen times three, and the answer is neither number in the text.',
    expect: { minutesByEntity: { 'Change the bed sheets': 45 }, toleranceMinutes: 0 },
  },
  {
    text: 'wash the dishes after dinner, ten minutes, and wipe the counters, another five.',
    why: 'two jobs in one sentence. The first test of whether the extractor splits at all, rather than returning one job with the total.',
    expect: { minutesByEntity: { 'Wash the dishes': 10, 'Wipe the counters': 5 }, toleranceMinutes: 0 },
  },
  {
    text: 'do the weekly shop, an hour and a half, and put the shopping away, fifteen minutes.',
    why: 'two jobs, two unit styles, and two jobs about the same shopping — which is where an extractor is most tempted to merge them into one.',
    expect: { minutesByEntity: { 'Do the weekly shop': 90, 'Put the shopping away': 15 }, toleranceMinutes: 0 },
  },
  {
    text: 'the usual: dishes, laundry, vacuuming.',
    why: 'AC 1 and AC 6. Three jobs are named and not one duration is. Every minute figure an extractor returns here is invented, and the app stores minutes, so an invented one goes straight into the fairness arithmetic.',
    ambiguous: 'names three jobs and no duration for any of them',
  },
  {
    text: 'sort out the garage sometime.',
    why: 'unbounded in both directions — the job has no edge and the duration is absent. The chore-side twin of "free most evenings".',
    ambiguous: 'no duration, and the job itself has no stated boundary',
  },
  {
    text: 'walk the dog, twenty minutes.',
    why: 'a short, unambiguous job. Deliberately does not say how often: a repeat is #53 territory and reading one out of this text would be an invented field.',
    expect: { minutesByEntity: { 'Walk the dog': 20 }, toleranceMinutes: 0 },
  },
  {
    text: 'clean the oven, that is a good two hours.',
    why: 'a hedge that reads as emphasis rather than uncertainty. "a good two hours" means at least two, so two is the figure and the tolerance carries the rest.',
    expect: { minutesByEntity: { 'Clean the oven': 120 }, toleranceMinutes: 15 },
  },
  {
    text: 'fold the laundry, twenty-five minutes.',
    why: 'a non-round figure. An extractor that snaps everything to fifteen-minute steps fails here and passes almost everywhere else.',
    expect: { minutesByEntity: { 'Fold the laundry': 25 }, toleranceMinutes: 0 },
  },
  {
    text: 'water the plants, five minutes, and feed the fish, two minutes.',
    why: 'two jobs at the very bottom of the range. chores.js sets MIN_EXPECTED_MINUTES at 1, so both are storable, and a rounding step of five would break the second.',
    expect: { minutesByEntity: { 'Water the plants': 5, 'Feed the fish': 2 }, toleranceMinutes: 0 },
  },
  {
    text: 'hoover the stairs, ten minutes.',
    why: 'the same activity as the vacuuming item under a different verb, so the corpus does not quietly reward a fixed vocabulary.',
    expect: { minutesByEntity: { 'Hoover the stairs': 10 }, toleranceMinutes: 0 },
  },
  {
    text: 'tidy up.',
    why: 'two words, no job boundary, no duration. The chore flow will receive this, and the only correct behaviour is to ask.',
    ambiguous: 'names neither a bounded job nor a duration',
  },
  {
    text: 'scrub the kitchen floor, three quarters of an hour.',
    why: 'a fraction of an hour spelled as a fraction of an hour, which is the phrasing most likely to come back as three or as four.',
    expect: { minutesByEntity: { 'Scrub the kitchen floor': 45 }, toleranceMinutes: 0 },
  },
  {
    text: 'clean the windows, roughly two hours for the whole house.',
    why: 'a hedge plus a scope clause. The scope changes nothing about the number and is there to be ignored.',
    expect: { minutesByEntity: { 'Clean the windows': 120 }, toleranceMinutes: 20 },
  },
  {
    text: 'empty the dishwasher, four minutes.',
    why: 'the shortest job in the corpus, and the one closest to chores.js refusing it outright.',
    expect: { minutesByEntity: { 'Empty the dishwasher': 4 }, toleranceMinutes: 0 },
  },
  {
    text: 'weed the front bed, somewhere between thirty and fifty minutes.',
    why: 'a range on the chore side, scored by the same midpoint-and-half-the-range rule the capacity ranges use.',
    expect: { minutesByEntity: { 'Weed the front bed': 40 }, toleranceMinutes: 10 },
  },
  {
    text: 'iron the shirts, five minutes a shirt, six shirts.',
    why: 'a second product, phrased in the opposite order to the bed sheets item so the pattern cannot be matched positionally.',
    expect: { minutesByEntity: { 'Iron the shirts': 30 }, toleranceMinutes: 0 },
  },
  {
    text: 'make the packed lunches, ten minutes; sweep the porch, five; and take the recycling out, five.',
    why: 'three jobs, two of them the same duration, and the second and third elide the unit. The only item where a merge would still produce a plausible total.',
    expect: {
      minutesByEntity: {
        'Make the packed lunches': 10,
        'Sweep the porch': 5,
        'Take the recycling out': 5,
      },
      toleranceMinutes: 0,
    },
  },
  {
    text: 'defrost the freezer, about an hour and a half.',
    why: 'a hedged compound duration — the hedge and the fraction are separate chances to be wrong.',
    expect: { minutesByEntity: { 'Defrost the freezer': 90 }, toleranceMinutes: 15 },
  },
  {
    text: 'deal with the shed at some point, could be an afternoon or could be ten minutes.',
    why: 'AC 6 on the chore side. Two durations an order of magnitude apart, offered as alternatives. A confident answer here is the failure the charter says destroys trust.',
    ambiguous: 'offers two durations an order of magnitude apart and chooses neither',
  },
  {
    text: 'clean the car inside and out, ninety minutes.',
    why: 'a title with a trailing qualifier that belongs to the job rather than to the duration, so the title boundary is the thing being tested.',
    expect: { minutesByEntity: { 'Clean the car inside and out': 90 }, toleranceMinutes: 0 },
  },
  {
    text: 'change the smoke alarm batteries, ten minutes.',
    why: 'the longest title in the corpus. A strict title match is only fair if the corpus contains titles long enough to be truncated, and this is one.',
    expect: { minutesByEntity: { 'Change the smoke alarm batteries': 10 }, toleranceMinutes: 0 },
  },
  {
    text: 'prune the hedge, half a day, so call it four hours.',
    why: 'a vague unit that the text then converts itself. The conversion is present, so this is answerable, and the hedge sets the tolerance.',
    expect: { minutesByEntity: { 'Prune the hedge': 240 }, toleranceMinutes: 30 },
  },
  {
    text: 'wash the bedding, forty minutes including hanging it out.',
    why: 'a second activity folded into one job by the description itself. Splitting it into two would be misattribution, not thoroughness.',
    expect: { minutesByEntity: { 'Wash the bedding': 40 }, toleranceMinutes: 0 },
  },
  {
    text: 'something needs doing about the loft.',
    why: 'names no job and no duration, and unlike "tidy up" it does not even name an activity. The floor of the ambiguous set.',
    ambiguous: 'names no job and no duration',
  },
  {
    text: 'clear the gutters, two hours, and it needs doing before the weather turns.',
    why: 'a trailing clause carrying urgency but no minutes. Urgency is not a field this contract has, so anything read out of it is invention.',
    expect: { minutesByEntity: { 'Clear the gutters': 120 }, toleranceMinutes: 0 },
  },
  {
    text: 'do the ironing for an hour and a quarter.',
    why: 'the same laundry area as two earlier items with a different job and a different figure, so the corpus cannot be passed by recognising a topic.',
    expect: { minutesByEntity: { 'Do the ironing': 75 }, toleranceMinutes: 0 },
  },
]

/** Every description, capacity first. Order is fixed so a run is reproducible. */
export const CORPUS = Object.freeze([
  ...CAPACITY.map((item) => ({ ...item, kind: 'capacity' })),
  ...CHORES.map((item) => ({ ...item, kind: 'chores' })),
])
