import PropTypes from 'prop-types'
import { useState } from 'react'
import { allocate, assess, minutesOf } from '../lib/allocation.js'
import { toAllocatorChores } from '../lib/chores.js'
import { isExcluded } from '../lib/exclusions.js'
import { formatMinutes } from '../lib/household.js'

// The split — story #47, and the product's thesis made visible.
//
// The charter's design idea, judged by the owner running a prototype before any
// story was written: SHOW EACH PERSON'S LOAD AS A SHARE OF THEIR OWN CAPACITY,
// so fair means every bar is level regardless of how different the people are.
// A parent at 150 of 300 and a kid at 30 of 60 are level, and the screen has to
// make that obvious without anybody reading a number.
//
// What this replaces: `Commitment` on the chore screen, which #36 shipped as
// deliberately the ugliest honest form — plain minutes, no bar, no percentage —
// with a comment saying #47 owns the presentation and replaces it. Its
// substance survives here in full (per-person committed minutes, "over" rather
// than a clamped zero, roster order, nothing that ranks). Leaving both would
// put two answers to one question on two screens, which is the fault
// capacity.js's own docstring calls invisible.
//
// THREE THINGS IT IS NOT, each of them a charter constraint rather than taste:
//
//   - Not a leaderboard. Ranking members by output is the exact inversion of
//     the thesis, so roster order is the only order and there is no rank,
//     position or score anywhere in the output. A smaller fair share must look
//     correct, never like losing.
//   - Not red for a person. Red is for work. An over-committed member is drawn
//     in the same palette as everybody else and the figures say "over"; the
//     styling does not shout it.
//   - Not a chore count. Every statement here is in minutes, because that is
//     the unit the fairness claim is made in — the prototype's third finding,
//     where "10 chores moved" beside "Nora -1 Ava +1" read as broken.

/**
 * Where the verdict comes from, and why there are two calls rather than one.
 *
 * `assess` answers "what is this household actually carrying, and is it level?"
 * over the assignments a HUMAN made. That is the arithmetic behind every bar.
 *
 * `allocate` answers a different question, and #47 criterion 4 asks it by name:
 * is level REACHABLE at all? A household that is simply not balanced yet and a
 * household where the granularity floor makes level arithmetically impossible
 * look identical from the first call — both are "not level" — and they deserve
 * opposite sentences. So the second call frees the OUTSTANDING work, pins what
 * is already done where it is, and asks the allocator for its best attempt.
 *
 * Done work is pinned rather than freed because it cannot be moved: it has
 * happened. It contributes `minutesOf`, so the probe divides the same total the
 * bars do rather than a hypothetical one made of estimates.
 *
 * Both are imported from `allocation.js` — criterion 5. There is no second
 * implementation of fair share, levelness or off-level in this repo, so the
 * screen cannot say "level" while the verdict disagrees.
 */
function verdictFor({ capacities, chores, exclusions }) {
  const normalized = toAllocatorChores(chores)
  const actual = assess({ members: capacities, chores: normalized })

  const isEligible = (chore, member) => !isExcluded(exclusions, chore.id, member.id)

  // Work nobody holds AND that is already done contributes nowhere — `assess`
  // drops it, so the probe must drop it too or the two would divide different
  // totals and disagree about a household neither is wrong about.
  const probe = normalized
    .filter((chore) => !(chore.done && chore.assignedMemberId == null))
    .map((chore) => ({
      id: chore.id,
      expectedMinutes: minutesOf(chore),
      assignedMemberId: chore.done ? chore.assignedMemberId : null,
    }))

  const best = allocate({ members: capacities, chores: probe, isEligible })

  return { actual, reachable: best.level, reason: best.reason }
}

/**
 * One person's bar.
 *
 * Two segments inside one track — #47 criterion 7. Done work and outstanding
 * work are visually distinct because "I have done my half" and "I have been
 * given my half" are different claims, and a single bar conflates them into the
 * one number the household is least likely to agree about.
 *
 * The widths are clamped to the track and the FIGURES are not. Somebody at 140%
 * of their capacity gets a full bar and a line that says how far over they are;
 * a bar that grew past its track would turn the row into a comparison between
 * people, which is the one thing this screen may not become.
 *
 * `role="img"` with the numbers in the label, because the bar is the whole
 * point of the screen and a screen reader must not be left with a decorative
 * div. The same numbers are in the text beside it, which is deliberate
 * redundancy rather than an oversight: the label states the SHARE, which is the
 * comparable quantity, and the text states the minutes, which is the checkable
 * one.
 */
function MemberBar({ name, capacityMinutes, doneMinutes, openMinutes, sharePercent }) {
  const committed = doneMinutes + openMinutes
  const donePercent = Math.min(100, (doneMinutes / capacityMinutes) * 100)
  const openPercent = Math.min(100 - donePercent, (openMinutes / capacityMinutes) * 100)
  const remaining = capacityMinutes - committed

  return (
    <>
      <div className="split__identity">
        <span className="split__name">{name}</span>
        <span className="split__figures">
          {committed} of {capacityMinutes} min
          <span aria-hidden="true"> · </span>
          {remaining < 0 ? `${Math.abs(remaining)} min over` : `${remaining} min left`}
        </span>
      </div>
      <div
        className="split__bar"
        role="img"
        aria-label={`${name} is carrying ${committed} of their ${capacityMinutes} minutes — ${sharePercent}% of their capacity`}
      >
        <span
          className="split__fill split__fill--done"
          data-testid="fill-done"
          style={{ width: `${donePercent}%` }}
        />
        <span
          className="split__fill split__fill--open"
          data-testid="fill-open"
          style={{ width: `${openPercent}%` }}
        />
      </div>
      {doneMinutes > 0 ? (
        <p className="split__breakdown">
          {doneMinutes} min done<span aria-hidden="true"> · </span>
          {openMinutes} min still to do
        </p>
      ) : null}
    </>
  )
}

MemberBar.propTypes = {
  name: PropTypes.string.isRequired,
  capacityMinutes: PropTypes.number.isRequired,
  doneMinutes: PropTypes.number.isRequired,
  openMinutes: PropTypes.number.isRequired,
  sharePercent: PropTypes.number.isRequired,
}

/**
 * The one sentence the household is here to read.
 *
 * The order of the branches is the honesty order, and the first branch is the
 * one that is easiest to get wrong. `isLevel` returns true for fewer than two
 * shares — correctly, a set that small has no spread — so an empty household,
 * or one where only one person has any minutes this week, would otherwise be
 * told "the split is level". That is a maximum score for doing nothing, and
 * `scripts/allocation-corpus-report.mjs` already refuses to fold those
 * scenarios into its headline figure for exactly the same reason. `contested`
 * is the flag that keeps this screen as honest as that report.
 */
function Verdict({ actual, reachable, reason, nameOf }) {
  if (!actual.contested) {
    const withCapacity = actual.load.length
    return (
      <p className="split__verdict" data-testid="split-verdict">
        {withCapacity === 0
          ? 'Nobody has any minutes this week, so there is no split to make.'
          : `Only ${nameOf(actual.load[0].memberId)} has minutes this week, so there is nothing to level yet.`}
      </p>
    )
  }

  if (actual.level) {
    return (
      <p className="split__verdict split__verdict--level" data-testid="split-verdict">
        The split is level.
      </p>
    )
  }

  // Not level. The off-level figure is stated first and unconditionally,
  // because it is the answer to the question the household came with — and it
  // is in MINUTES, never a count.
  const off = actual.offLevel

  return (
    <p className="split__verdict" data-testid="split-verdict">
      {off ? (
        <>
          The split is {off.minutes} min off level — {nameOf(off.memberId)} is carrying{' '}
          {off.minutes} min more than their share.
        </>
      ) : (
        <>The split is not level.</>
      )}
      {!reachable && reason ? (
        <>
          {' '}
          Level cannot be reached this week: {nameOf(reason.memberId)}&rsquo;s fair share is{' '}
          {reason.fairShareMinutes} min and the smallest job is {reason.smallestJobMinutes} min.
        </>
      ) : null}
    </p>
  )
}

Verdict.propTypes = {
  actual: PropTypes.object.isRequired,
  reachable: PropTypes.bool.isRequired,
  reason: PropTypes.object,
  nameOf: PropTypes.func.isRequired,
}

/**
 * What the last automatic re-balance had to say for itself — #49 AC 7.
 *
 * Rendered from the verdict the run STORED (`households.last_rebalance`),
 * never recomputed here, and the distinction is the criterion: whether the
 * change budget bound the result depends on the state the run replaced, which
 * no read of the current rows can reconstruct. A surface that re-derived it
 * would eventually state a different reason than the run recorded, and two
 * disagreeing sentences about one household is the charter's named
 * trust-killer.
 *
 * This is deliberately NOT the `Verdict` above. That one answers "is the
 * household level, and is level reachable at all?" over what people are
 * actually carrying — a live question, freeing everything, asked fresh each
 * render (#47). This one reports what the last run DID: two different
 * questions, each honest, and folding them into one sentence would make the
 * stored facts look recomputed. The richer presentation exists now — #50's
 * `Announcement`, the event shown once above the tabs — and this line still
 * stands beside it on purpose: the event is seen once and dismissed, while a
 * member who arrives days later needs the run's footnote to still be here.
 */
function LastRebalance({ verdict, nameOf }) {
  if (!verdict) return null
  if (verdict.boundByBudget) {
    return (
      <p className="split__rebalance" data-testid="rebalance-note">
        The last re-balance moved {verdict.minutesMoved} min and stopped there — the change
        budget ({verdict.changeBudgetMinutes} min) held the rest of the week where it was.
      </p>
    )
  }
  if (verdict.contested && !verdict.level && verdict.reason) {
    return (
      <p className="split__rebalance" data-testid="rebalance-note">
        The last re-balance could not make the split level: {nameOf(verdict.reason.memberId)}
        &rsquo;s fair share is {verdict.reason.fairShareMinutes} min and the smallest job is{' '}
        {verdict.reason.smallestJobMinutes} min.
      </p>
    )
  }
  return null
}

LastRebalance.propTypes = {
  verdict: PropTypes.object,
  nameOf: PropTypes.func.isRequired,
}

/**
 * What the fairness number does not count — story #59, the charter's
 * ambition 4 ("the invisible half is at least acknowledged").
 *
 * ONE LINE, and the wording is criteria rather than taste:
 *
 *   - It attributes the uncounted work to NOBODY (AC 2). No name, no figure,
 *     no rank appears in the sentence, because the moment it says who does the
 *     noticing it has modelled the dimension — which is the open charter
 *     decision this story exists NOT to answer, and the direct route to the
 *     leaderboard the design direction forbids.
 *   - It promises NOTHING (AC 4). No "yet", no "coming", no future tense about
 *     a feature. Deciding later to model noticing properly must not make this
 *     copy retroactively a lie — so the copy is a present-tense statement of
 *     what the number is, which stays true whatever ships after it.
 *
 * The statement stands until THIS MEMBER dismisses it, and the dismissal is
 * per member on the server (owner decision at pickup): another phone must not
 * close a statement this member has not read, and a reinstall must not reopen
 * one they have. After dismissal it is reachable on demand (AC 3) — the
 * disclosure toggle below, whose open/closed state is deliberately local and
 * unpersisted, because "show it to me again" is a moment, not a fact about
 * the member.
 */
function FairnessNote({ dismissed, onDismiss }) {
  const [open, setOpen] = useState(false)

  const statement = (
    <p className="split__note" data-testid="fairness-note">
      The split counts time spent doing the work. Noticing, planning and
      remembering it is work it does not count.
    </p>
  )

  if (!dismissed) {
    return (
      <div className="split__note-block">
        {statement}
        {/* Not "Got it": #50's announcement uses that label and can stand on
            the same screen, and two identically named buttons doing different
            things is an ambiguity a screen reader cannot resolve. */}
        <button type="button" className="button button--quiet" onClick={onDismiss}>
          Noted
        </button>
      </div>
    )
  }

  return (
    <div className="split__note-block">
      <button
        type="button"
        className="button button--quiet"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        What the split counts
      </button>
      {open ? statement : null}
    </div>
  )
}

FairnessNote.propTypes = {
  dismissed: PropTypes.bool.isRequired,
  onDismiss: PropTypes.func.isRequired,
}

export default function Split({
  members,
  chores,
  capacities,
  exclusions,
  lastRebalance,
  error,
  fairnessNoteDismissed,
  onDismissFairnessNote,
  onDealOut,
  busy = false,
}) {
  const { actual, reachable, reason } = verdictFor({ capacities, chores, exclusions })

  const nameOf = (memberId) => members.find((m) => m.id === memberId)?.display_name ?? 'Someone'

  // ROSTER ORDER, and it comes from `members` rather than from the verdict —
  // criterion 6. `assess` sorts its own output by id so that input order cannot
  // reach the arithmetic, which is the right rule there and the wrong one here:
  // an id sort is still an order nobody chose. Folding over the roster is what
  // makes "in the order the household added people" true by construction
  // instead of by coincidence.
  const shareOf = new Map(actual.load.map((entry) => [entry.memberId, entry]))
  const carriedBy = new Map(actual.noCapacity.map((entry) => [entry.memberId, entry]))

  const unassigned = chores.filter((chore) => actual.unassigned.includes(chore.id))
  const unassignedMinutes = unassigned.reduce((sum, c) => sum + (c.expected_minutes || 0), 0)

  return (
    <div className="split">
      <section className="card" aria-labelledby="split-heading">
        <h2 id="split-heading" className="card__heading">
          The split
        </h2>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <Verdict actual={actual} reachable={reachable} reason={reason} nameOf={nameOf} />

        <LastRebalance verdict={lastRebalance} nameOf={nameOf} />

        {/* #59 — directly under the verdict, because the verdict IS the
            fairness claim and this line is the claim's own stated boundary.
            A boundary behind a tab or at the bottom of the page is one the
            person reading "The split is level." never sees. */}
        <FairnessNote dismissed={fairnessNoteDismissed} onDismiss={onDismissFairnessNote} />

        {members.length === 0 ? (
          <p className="card__body">
            Nobody in the household yet. Add people on the Who tab — the split is
            proportional to the minutes each of them actually has.
          </p>
        ) : (
          <ul className="split__list">
            {members.map((member) => {
              const entry = shareOf.get(member.id)
              const held = carriedBy.get(member.id)
              // Keyed on ABSENCE FROM THE SPLIT, not on presence in the
              // no-capacity list. The two are the same set today — `assess` puts
              // every member in exactly one — and they stop being the same the
              // moment this surface is handed a `capacities` list shorter than
              // its roster, which `App.jsx` produces for one render if a period
              // is ever resolved after a household. Keyed the other way that
              // member would be drawn a bar dividing by a capacity nobody gave
              // us: `NaN%`, which lays out as an empty bar and reads as a person
              // carrying nothing. Criterion 8 asks that no division by zero
              // occur, and this is where it would.
              return (
                <li className="split__row" key={member.id} data-testid={`split-${member.id}`}>
                  {!entry ? (
                    // Criterion 8. A share is minutes over capacity, so this
                    // person has no share — not a share of zero, and emphatically
                    // not the infinity a division would produce. They are named
                    // with what they are holding, because somebody with no
                    // minutes this week who is still carrying work is exactly
                    // what the household needs to see.
                    <div className="split__identity">
                      <span className="split__name">{member.display_name}</span>
                      <span className="split__figures" data-testid="no-capacity">
                        No minutes this week
                        {held?.assignedMinutes > 0 ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            {held.assignedMinutes} min still assigned
                          </>
                        ) : null}
                      </span>
                    </div>
                  ) : (
                    <MemberBar
                      name={member.display_name}
                      // Every figure from the ONE entry `assess` produced, so
                      // the bar and the arithmetic behind the verdict cannot be
                      // dividing by different numbers.
                      capacityMinutes={entry.capacityMinutes}
                      doneMinutes={entry.doneMinutes}
                      openMinutes={entry.openMinutes}
                      sharePercent={Math.round(entry.share * 100)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Criterion 9. Work nobody holds is excluded from the fairness
          arithmetic — counting it would inflate every fair share against work
          no member has taken on — so without this area it would be excluded
          from the screen as well, which is how a household comes to believe
          something is handled. On the same screen, deliberately: a needs-
          attention area behind a tab is a needs-attention area nobody sees. */}
      {unassigned.length > 0 ? (
        <section className="card" aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="card__heading">
            Needs attention
          </h2>
          <p className="card__note" data-testid="unassigned-total">
            {unassignedMinutes} min of work nobody has yet
            <span className="chore__cost-human"> ({formatMinutes(unassignedMinutes)})</span>
          </p>
          {/* #284 — the route from "everything entered" to a first fair split.
              Measured on #52: a from-nothing household reached this screen
              with every member, capacity, chore and exclusion in and found
              NO control at all, because #49's automatic run is triggered by a
              capacity change and at setup every capacity is set before any
              chore exists. The only route was thirteen Who dropdowns.

              This is deliberately not the re-balance button the charter's
              decision log ruled out. That ruling is about work people already
              hold — a button there is the negotiation moved rather than
              removed. Work NOBODY holds has no negotiation in it: there is no
              before-state to defend and no one being asked to give something
              up. So the action lives inside the needs-attention area and
              nowhere else — it exists exactly when this area does.

              It runs the SAME re-assignment a capacity change runs
              (`reassignHousehold` → `apply_assignments`, "like any other
              run" in the issue's words), so a chore somebody placed by hand
              is pinned and its minutes counted (#49 AC 4), the stability
              rule and change budget apply to anything auto-placed, and the
              verdict is stored where `LastRebalance` reads it. A second code
              path that only touched the unassigned set would be a second
              placement rule, which #40 AC 9 forbids.

              Offered only while somebody has minutes this week: with nobody
              at capacity the allocator can place nothing (#49 AC 5), and a
              button that visibly does nothing is worse than none. The
              verdict above already says there is no split to make. */}
          {onDealOut && actual.load.length > 0 ? (
            <div className="split__deal">
              {/* The refusal is on screen already — `mutate()` put it in
                  `error`, rendered above — so the promise is settled here the
                  way every other control's is, rather than left to reject
                  unhandled. */}
              <button
                type="button"
                className="button"
                onClick={() => onDealOut().then(() => {}, () => {})}
                disabled={busy}
              >
                Deal these out
              </button>
              <p className="split__deal-note">
                Shares this work out by each person&rsquo;s minutes. Anything you placed by hand
                stays where it is.
              </p>
            </div>
          ) : null}
          <ul className="split__attention">
            {unassigned.map((chore) => (
              <li className="split__attention-row" key={chore.id}>
                <span className="split__attention-title">{chore.title}</span>
                <span className="split__attention-cost">{chore.expected_minutes} min</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

Split.propTypes = {
  members: PropTypes.array.isRequired,
  chores: PropTypes.array.isRequired,
  capacities: PropTypes.array.isRequired,
  exclusions: PropTypes.array.isRequired,
  lastRebalance: PropTypes.object,
  error: PropTypes.string,
  fairnessNoteDismissed: PropTypes.bool.isRequired,
  onDismissFairnessNote: PropTypes.func.isRequired,
  onDealOut: PropTypes.func,
  busy: PropTypes.bool,
}
