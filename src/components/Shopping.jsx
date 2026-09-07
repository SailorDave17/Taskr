import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import {
  finishedLabel,
  firstNameOf,
  groupClosedRuns,
  normalizeName,
  orderShoppingItems,
  purchasedLabel,
} from '../lib/shopping.js'

// The Shop tab — story #353, the first surface of epic #349.
//
// The household's shopping list on one screen: everyone adds to it, and whoever
// goes shopping reads the whole thing on one phone. It is the first surface in
// the app with NO fairness arithmetic behind it — nothing here completes a
// chore or counts a minute — and the charter's 2026-09-05 decision admits it as
// a standalone household utility for exactly that reason. What it borrows is
// everything underneath: the same roster, the same one-household scoping, the
// same database-clock stamps, and the same re-read-on-open every tab performs.
//
// What this surface does NOT do, and why each absence is deliberate:
//
//   - It does not DELETE a list, and #360 did not add one either. Putting a
//     list away is an archive: a stamp on the row, the list off the picker, and
//     every run it ever had still readable. See the section on it below.
//   - It does not rank, count or score who added what. #35 AC 9 binds this
//     surface as it binds Done: an item says who added it, and no figure
//     anywhere says how many anyone added. Shopping.test.jsx fails on one.
//
// THE EMPTY STATE IS A FORM, NOT A WRITE. A household with no list sees a name
// field prefilled "Groceries" and a Create control (owner decision, 2026-09-05,
// against auto-creating the first list): nothing is written until somebody
// taps, so opening the tab is a read like opening any other. The name is
// prefilled rather than placeholder text because the default is the answer for
// nearly everybody, and a prefilled field is one tap where a placeholder is a
// tap and a word.
//
// Both forms carry `noValidate` for the reason Chores.jsx records: a `required`
// attribute would make the browser refuse the submit itself, and the person
// would read the browser's bubble instead of the sentence written here. The
// refusal is ours — `normalizeName`, the same function the data layer calls,
// so there is one wording and it is tested.
//
// Who added an item is resolved from the ROSTER by `added_by_member_id`, at
// render, never from state this phone held when it submitted the form. The
// row's stamp is the database's, the roster is the read's, and a name held
// locally would be right on the phone that added the item and wrong on every
// other. A member the roster no longer holds (removed; the FK nulls the stamp)
// simply has no "added by" line. Who BOUGHT it (#355) is resolved exactly the
// same way, from `purchased_by_member_id`, and its time comes from
// `purchased_at` — the database clock, never this phone's.
//
// THE TICK, AND THE ORDER — story #355, the moment the epic protects.
//
// The whole row is the primary control: a full-width button at least 44px tall
// whose label is the item itself, so the gesture in a supermarket aisle is a
// tap anywhere on the thing you just put in the cart, one-handed, without
// aiming. Remove keeps its own quiet control underneath, because removing an
// item and buying it are opposite intentions and a person walking a store will
// tap the big one.
//
// Bought items sink below every unbought one (`orderShoppingItems`), so the
// next thing to look for is always at the top of the screen. That is what
// makes this a shopping list rather than a to-do list with checkboxes, and the
// component does not do the sorting itself: it is a pure function in
// shopping.js with its own tests, and this file only draws what it returns.
// The DOM order IS that order — no CSS reordering — so what a screen reader
// hears and what an eye sees cannot come apart.
//
// A bought row is history with a way back: it reads "bought by Robin · 4:02 PM"
// and offers "Not bought after all", the app's reversible-action idiom from
// Chores and Done — no dialog, because the reversal of a mistap is a tap.
//
// THE END OF THE TRIP — story #357, and the one control here that is NOT
// reversible.
//
// "Done shopping" closes the run and opens the next one with everything
// unbought carried forward, in one server transaction (`0033`). A mis-tap
// cannot be undone: the run is closed, the next one exists, and anything
// anybody adds to it afterwards would have to be reconciled by an undo that
// does not exist. So the mitigation is an inline two-step confirm NAMING THE
// CONSEQUENCE — "3 items not bought will carry over to the next list" — which
// is epic #349's decision 8, taken against an undo. `window.confirm` is not
// used, here or anywhere in this app: the confirm is the same confirm-in-place
// idiom Roster uses for Remove and for signing every device out.
//
// Two details of it are load-bearing rather than taste:
//
//   - FOCUS LANDS ON "Keep shopping", not on "Finish". The confirm appears
//     under a thumb that has just tapped, and a keyboard or a switch user
//     arrives on it with Enter armed; landing on the way out means an
//     accidental Enter costs a tap and not a trip.
//   - The confirming control is the PRIMARY button, not `button--danger`.
//     Finishing a run destroys nothing — the unbought items move forward and
//     the bought ones stay on the closed run as its record — so the red the
//     roster's Remove wears would be saying something untrue.
//
// SEVERAL LISTS, AND THE ONE ON SCREEN — story #358.
//
// A household shops at more than one kind of store, and a hardware list mixed
// into groceries is the failure the feature exists to remove (the charter's
// rejected one-list alternative). So a household holds several named lists and
// this tab draws exactly ONE of them at a time, chosen in a picker above it.
// Choosing which list an item goes on is choosing the list you are on: there is
// no per-item list menu, and the add form under a list can only ever aim at
// that list's open run.
//
// Three consequences of "one at a time" that are decisions rather than
// mechanics:
//
//   - THE PICKER APPEARS ONLY WITH A SECOND LIST. A segmented control holding
//     one button offers no choice, and this app already refuses to draw a
//     control whose only outcome is nothing (Remove on a bought row, Done
//     shopping on an empty run). A household with one list therefore sees
//     exactly what it saw before this story, plus a quiet "New list".
//   - EACH BUTTON CARRIES ITS OWN COUNT, and the count line under the heading
//     stands down while it does. The other lists' counts are the whole reason
//     to look at the picker — "3 left to buy" on Hardware is what tells a
//     person to switch — and printing the selected list's count twice on one
//     screen would be two representations of one number.
//   - THE CHOICE IS APP STATE, not a device setting. It is held beside `view`
//     in App.jsx and resolved through `resolveSelectedListId`, so it survives a
//     tab switch (this component unmounts) and falls back to the first list by
//     name whenever it names nothing the current read holds — a household
//     change, a removal, an arrival. Nothing is written to the server and
//     nothing to browser storage: which list a phone is looking at is not a
//     fact about the household.
//
// RENAMING IS INLINE, ON THE HEADING, and it is the one write here that is not
// an RPC — `0032` grants `update (name)` on `shopping_lists` and nothing else,
// so the client can rename a list and can move it nowhere. Any member may do
// it, like every other write on this surface (the epic's decision 2). Cancel
// writes nothing, and is a plain button rather than a form reset so that the
// heading comes back with the name the server has rather than the one that was
// typed over it.
//
// A DUPLICATE NAME IS THE ONE REFUSAL A PERSON CAN FIX. The unique index in
// `0032` is `(household_id, lower(name))`, so "Groceries" and "groceries" are
// one name; both writers hit it, and shopping.js turns SQLSTATE 23505 into a
// sentence naming the name that was typed. It arrives on the error strip below
// like every other refusal — the strip is outside the lists deliberately, and
// a refused create or rename leaves the form open with the text still in it.
//
// A carried item says so: `carried_from_item_id` is not null on the copy, and
// the row reads "from last run" beside who added it. The adder and the time
// are the ORIGINAL's (`0033` copies both, deliberately — the finisher is the
// one member known not to have added it), which is also why a carried item
// sorts to the top of the next run's unbought half without this file doing
// anything: its `added_at` predates the run it is on.
//
// WHAT THE HOUSEHOLD ALREADY BOUGHT — story #359, and the epic's decision 6.
//
// "Did anyone get coffee last week?" is answerable here rather than by asking
// somebody: every finished run is kept (`0033` closes a run, it deletes
// nothing) and this is the only screen that reads one. It is a disclosure at
// the foot of the list rather than a sixth tab — the strip #350 measured is
// full at five, and the Done tab is organised by capacity weeks, where a
// shopping trip would sit among chores.
//
// Three properties of it are decisions rather than mechanics:
//
//   - IT IS READ WHEN IT IS OPENED, not on arrival. Everything else on this
//     surface is re-read on every tab press because what it returns is bounded;
//     history grows by one run per trip forever. The read is `readClosedRuns`
//     and the trigger is the disclosure's own `onToggle`, so a household that
//     never looks back never pays for it. App.test.jsx asserts both halves —
//     that arriving on Shop does not read it, and that opening does.
//   - EACH RUN IS ITSELF A DISCLOSURE, and only the newest opens. That is
//     `Done.jsx`'s `open={index === 0}` idiom, taken at the owner's design-bar
//     decision of 2026-09-01 on a measurement rather than a description: eight
//     runs of fifteen items rendered open is a scroll nobody asked for, and a
//     closed run's heading already answers "when, and how big".
//   - IT COUNTS ITEMS AND NEVER PEOPLE. "3 bought, 1 carried over" is a fact
//     about a trip; #35 AC 9 binds this surface as it binds Done, so there is
//     no per-person total, no rank and nothing about who bought the most.
//     Shopping.test.jsx fails on one.
//
// PUTTING A LIST AWAY — story #360, and the last of epic #349's first phase.
//
// A list for a renovation, or for a party that happened, is finished with long
// before the household is finished with the app. It leaves the picker and it
// loses nothing: `archived_at` is a stamp, not a delete, and everything #359
// draws about it stays exactly where it was.
//
// Four properties of it are decisions rather than mechanics:
//
//   - THE TOGGLE APPEARS ONLY ONCE SOMETHING IS ARCHIVED, and it carries the
//     count. A household that never archives anything sees precisely the tab it
//     saw before this story. It sits in the picker's region rather than beside
//     "New list" because what it changes is which lists the picker draws, and a
//     control whose effect happens at the other end of the screen is a control
//     people press twice to find out what it did.
//   - IT DOES NOT FORCE THE PICKER TO EXIST. #358 refuses to draw a segmented
//     control holding one button, and that still holds: a household with one
//     active list and one archived one sees no picker until it reveals the
//     archived one, at which point there are two lists and a choice to make.
//   - AN ARCHIVED LIST IS ITS HISTORY AND NOTHING ELSE. No add form, no Done
//     shopping, no count, no Rename — one line saying what it is, the past runs,
//     and the way back. Its open run is EMPTY by construction: `0035` refuses an
//     archive while the run holds any item, which is what makes "there is
//     nothing here to draw" a fact about the database rather than a decision to
//     hide something. The refusal names both ways out ("finish or clear this run
//     first") and both are on screen when it fires.
//   - ARCHIVE SITS BESIDE RENAME, on the heading, because both are things you do
//     to the LIST — the rule the rule above `New list` states. It is a quiet
//     control and not `button--danger`: nothing is destroyed, and the red the
//     roster's Remove wears would be saying something untrue, exactly as it
//     would on Done shopping.
//
// A NAME STAYS TAKEN WHILE IT IS ARCHIVED. The unique index is
// `(household_id, lower(name))` and `0035` does not exclude archived rows from
// it, so naming a new list "Groceries" while an archived "Groceries" exists is
// refused with #358's own sentence. That is the better failure of the two: the
// alternative is a household holding two lists it cannot tell apart in a picker
// that shows the name and nothing else.
//
// A row here is deliberately NOT the working row struck through — the #302
// design-bar verdict, and #308's direction for the Done tab: it is one compact
// line carrying the name, its note, and either who bought it and when or the
// fact that it went forward to the next run. No tick and no Remove: a closed
// run is a record, and `0034`/`0033` would refuse a write to one anyway.

/**
 * Trim an optional note and turn an empty one into null.
 *
 * The data layer does the same (`addItem` sends `note: null` for a blank
 * string), so this is not a second rule — it is the form saying "omitted" in
 * the shape the App-level contract asserts, so a test at that level can hold
 * the handler to `null` rather than to whatever whitespace the field held.
 */
function noteOrNull(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The list count as one sentence — #355's line, and #358's picker label.
 *
 * One wording in one place, used by the picker button and by the count under a
 * lone list's heading, because they are the same fact about the same rows: a
 * screen that said "3 left to buy" in one and "3 left" in the other would be
 * describing one number two ways.
 */
function leftToBuy(left) {
  return left > 0 ? `${left} left to buy` : 'Nothing left to buy'
}

/**
 * Name a list into existence — the household's first (#353) or another (#358).
 *
 * The two callers differ in exactly two things, and both are props rather than
 * a second component: the first list arrives prefilled "Groceries" under a
 * sentence explaining the empty tab, and a later one arrives EMPTY with a way
 * out. Empty because there is no name a second list is likely to want — the
 * household already used the obvious one — and a prefilled field that has to be
 * cleared first is worse than an empty one.
 */
function CreateListForm({ busy, initialName, intro, onCreateList, onCancel }) {
  const [name, setName] = useState(initialName)
  const [complaint, setComplaint] = useState(null)

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        let clean
        try {
          clean = normalizeName(name)
        } catch (err) {
          // The refusal happens here, before onCreateList is ever called, so an
          // empty name never becomes a request (#358 AC 1).
          setComplaint(err.message)
          return
        }
        setComplaint(null)
        // Two arms, both empty: on success the re-read replaces this form with
        // the list it made, and on failure App's mutate() has already put the
        // message in the strip below. Nothing here is patched from the answer —
        // including the duplicate-name refusal, which leaves the field as it
        // was typed so the name can be edited rather than retyped.
        onCreateList(clean).then(
          () => {},
          () => {},
        )
      }}
    >
      {intro ? <p className="card__body">{intro}</p> : null}
      <label className="field">
        <span className="field__label">List name</span>
        <input
          className="field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoComplete="off"
        />
      </label>
      {complaint ? (
        <p className="error" role="alert">
          {complaint}
        </p>
      ) : null}
      <div className="row row--end">
        <button className="button" type="submit" disabled={busy}>
          Create list
        </button>
        {onCancel ? (
          <button className="button button--quiet" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  )
}

CreateListForm.propTypes = {
  busy: PropTypes.bool,
  initialName: PropTypes.string.isRequired,
  intro: PropTypes.string,
  onCreateList: PropTypes.func.isRequired,
  onCancel: PropTypes.func,
}

/**
 * Which list is on screen — #358 AC 1, and the only navigation on this tab.
 *
 * Segmented buttons rather than a `<select>`: the whole set is visible at a
 * glance with its counts, and switching is one tap in a store rather than a
 * tap, a scroll and a tap. `aria-pressed` is the state — a toggle-button group,
 * which is what this is — and NOT `aria-current`, which the tab strip above
 * uses for the page you are on; two different things should not borrow one
 * attribute.
 *
 * The buttons are drawn in the order the caller hands them over
 * (`orderShoppingLists`, by name), so the row a person learns does not move
 * when a list is renamed... it moves to where the new name sorts, which is the
 * point: the order is a property of the names, and both are visible.
 */
function ListPicker({ lists, runs, items, selectedListId, busy, onSelectList }) {
  return (
    <div className="shopping-picker" role="group" aria-label="Which list">
      {lists.map((list) => {
        const run = runs.find((r) => r.list_id === list.id) ?? null
        const left = run
          ? items.filter((item) => item.run_id === run.id && !item.purchased_at).length
          : 0
        // #360 — an archived list says so where every other list says how much
        // is left to buy. The count would be honest and useless: an archived
        // list's open run is empty by `0035`'s precondition, so every one of
        // them would read "Nothing left to buy" — a sentence about shopping, on
        // a list nobody is shopping from, in the one place a person is choosing
        // between them.
        const archived = Boolean(list.archived_at)
        return (
          <button
            key={list.id}
            className="shopping-picker__list"
            type="button"
            aria-pressed={list.id === selectedListId}
            disabled={busy}
            onClick={() => onSelectList(list.id)}
          >
            <span className="shopping-picker__name">{list.name}</span>
            <span className="shopping-picker__count">{archived ? 'Archived' : leftToBuy(left)}</span>
          </button>
        )
      })}
    </div>
  )
}

ListPicker.propTypes = {
  lists: PropTypes.array.isRequired,
  runs: PropTypes.array.isRequired,
  items: PropTypes.array.isRequired,
  selectedListId: PropTypes.string,
  busy: PropTypes.bool,
  onSelectList: PropTypes.func.isRequired,
}

/**
 * The list's name, and the way to change it — #358 AC 4.
 *
 * The heading IS the control's subject, so the rename happens where the name
 * is: tapping Rename swaps the heading for a field holding the current name,
 * and Save or Cancel puts it back. Mounted with `key={list.id}` by the caller,
 * which is what closes it when the picker moves to another list — an open
 * editor carried across a switch would be offering to rename a list nobody is
 * looking at.
 *
 * THE NAME IS A SUBJECT HERE, NOT A SECTION LABEL, and that is the owner's call
 * at this story's design pass on a measurement: drawn as `card__subheading` the
 * list's own name read 15px/600 dim against a 16px/500 full-strength Rename in
 * a 92×44 control — the faintest text in its own region, with an item name
 * below it at 17px/600. It now wears the roster's subject grade, which is what
 * this app already does with a member's name beside its quiet controls.
 *
 * AND IT STANDS DOWN WHEN THE PICKER IS UP (`showName`), on the same rule as
 * the count: the pressed picker button already carries the name at full
 * strength, and a second copy 130px below it would be two representations of
 * one thing. The control keeps an accessible name that says WHICH list, since
 * the visible word "Rename" then has no name beside it. The region's own label
 * is unaffected either way — its caller names it from `list.name` rather than
 * from whichever element happens to be drawing it.
 */
function ListHeading({ list, busy, showName, onRenameList, onArchiveList, onUnarchiveList }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(list.name)
  const [complaint, setComplaint] = useState(null)
  const fieldRef = useRef(null)
  const archived = Boolean(list.archived_at)

  useEffect(() => {
    if (editing) fieldRef.current?.focus()
  }, [editing])

  // #360 — an archived list holds ONE control and the way back is it. Rename
  // goes with the rest of the working surface: the client's `update (name)`
  // grant is untouched by `0035`, so this is a screen decision rather than a
  // refusal waiting to happen, and the reason is that a list somebody put away
  // is a record — the name on it is the name the household filed it under.
  if (archived) {
    return (
      <div className="shopping-heading">
        {showName ? <h3 className="shopping-heading__name">{list.name}</h3> : null}
        <button
          className="button button--quiet"
          type="button"
          aria-label={`Unarchive ${list.name}`}
          disabled={busy}
          onClick={() =>
            onUnarchiveList(list.id).then(
              () => {},
              () => {},
            )
          }
        >
          Unarchive
        </button>
      </div>
    )
  }

  if (!editing) {
    return (
      <div className="shopping-heading">
        {showName ? <h3 className="shopping-heading__name">{list.name}</h3> : null}
        {/* THE TWO CONTROLS WRAP AS ONE UNIT, and that is a measurement rather
            than tidiness. At 360 the row has 263.2px and "Groceries" (72.3) +
            Rename (92) + Archive (87.6) + two 8px gaps is 267.9 — over by 4.7px
            — so with all three as siblings of the flex row, Rename stayed
            beside the name and Archive alone dropped to a second row, reading
            as an unrelated control rather than as one of a pair. Grouped, the
            name takes row one and both controls take row two together, which is
            also what a long name does. Owner's call at #360's design pass. */}
        <span className="shopping-heading__actions">
          <button
            className="button button--quiet"
            type="button"
            aria-label={`Rename ${list.name}`}
            disabled={busy}
            onClick={() => {
              // Opened from the SERVER's name every time, never from whatever
              // was left in the field by an abandoned edit or a refused save.
              setName(list.name)
              setComplaint(null)
              setEditing(true)
            }}
          >
            Rename
          </button>
          {/* #360 — no confirm in front of it, unlike Done shopping, and the
              asymmetry is the point: a finish cannot be undone and this is
              undone by the control that replaces it. A refusal ("finish or
              clear this run first") arrives on the strip below, which the tab
              scrolls into view — see the Shopping component's own effect, and
              the measurement behind it. */}
          <button
            className="button button--quiet"
            type="button"
            aria-label={`Archive ${list.name}`}
            disabled={busy}
            onClick={() =>
              onArchiveList(list.id).then(
                () => {},
                () => {},
              )
            }
          >
            Archive
          </button>
        </span>
      </div>
    )
  }

  return (
    <form
      className="stack shopping-rename"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        let clean
        try {
          clean = normalizeName(name)
        } catch (err) {
          setComplaint(err.message)
          return
        }
        setComplaint(null)
        onRenameList(list.id, clean).then(
          () => setEditing(false),
          // A refusal — a duplicate name, most of all — leaves the editor open
          // with the text still in it and the sentence on the strip below, so
          // the fix is an edit rather than a retype. This is the one form on
          // this surface that patches itself from the answer, and only in the
          // success arm.
          () => {},
        )
      }}
    >
      <label className="field">
        <span className="field__label">
          List name
        </span>
        <input
          ref={fieldRef}
          className="field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoComplete="off"
        />
      </label>
      {complaint ? (
        <p className="error" role="alert">
          {complaint}
        </p>
      ) : null}
      <div className="row row--end">
        <button className="button" type="submit" disabled={busy}>
          Save name
        </button>
        <button
          className="button button--quiet"
          type="button"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

ListHeading.propTypes = {
  list: PropTypes.object.isRequired,
  busy: PropTypes.bool,
  showName: PropTypes.bool,
  onRenameList: PropTypes.func.isRequired,
  onArchiveList: PropTypes.func.isRequired,
  onUnarchiveList: PropTypes.func.isRequired,
}

/** One item on the open run. */
function ShoppingItem({
  item,
  members,
  timezone,
  busy,
  onRemoveItem,
  onPurchaseItem,
  onUnpurchaseItem,
}) {
  const bought = Boolean(item.purchased_at)
  // #357 — this row is a copy the last finish carried forward. The column is
  // the whole test: `0033` sets it on the copy and on nothing else, so a
  // client that guessed from `added_at < opened_at` would be inferring what
  // the database already states.
  const carried = Boolean(item.carried_from_item_id)
  const adder = members.find((m) => m.id === item.added_by_member_id)
  const adderName = adder ? firstNameOf(adder.display_name) : null
  const buyer = members.find((m) => m.id === item.purchased_by_member_id)
  const stamp = bought ? purchasedLabel(item.purchased_at, buyer ? firstNameOf(buyer.display_name) : null, timezone) : null

  // The row's text, drawn identically inside the tick button and outside it.
  // One definition rather than two so the bought and unbought halves cannot
  // drift into saying different things about the same row.
  //
  // The mark before it is the affordance, and it is the one thing the jsdom
  // suite could not have told us we needed: measured on the prototype at
  // 360×800, a row whose only visible control was Remove read as a row whose
  // action WAS Remove — a full-width tap target with nothing drawn on it is
  // invisible, and the loudest thing on the row was the destructive control.
  // `aria-hidden`, because the button's own label already says what a tap
  // does and a screen reader should not hear a shape read out.
  const body = (
    <span className="shopping-item__body">
      <span className="shopping-item__name">{item.name}</span>
      {item.note ? <span className="shopping-item__note">{item.note}</span> : null}
      {/* #357 — "from last run" rides on the SAME line as the adder rather
          than taking one of its own: after a finish every carried item is at
          the top of the list, so a third line would be paid on every row a
          person sees first. Its own span so the mark can carry weight the rest
          of the meta line does not. */}
      {carried || adderName || stamp ? (
        <span className="shopping-item__meta">
          {carried ? <span className="shopping-item__carried">from last run</span> : null}
          {carried && (adderName || stamp) ? ' · ' : null}
          {adderName ? `added by ${adderName}` : null}
          {adderName && stamp ? ' · ' : null}
          {stamp}
        </span>
      ) : null}
    </span>
  )

  return (
    // The bought modifier is conditional, the way `chore--missed` is on the
    // chore row, and the gate's stylesheet check cannot see a conditional
    // class — so `.shopping-item--bought` has its rule in index.css by hand,
    // beside the static ones the check does read.
    <li className={bought ? 'shopping-item shopping-item--bought' : 'shopping-item'}>
      {bought ? (
        <>
          <span className="shopping-item__mark shopping-item__mark--done" aria-hidden="true">
            ✓
          </span>
          {body}
        </>
      ) : (
        // #355 — the whole row is the tap target. The accessible name says the
        // ACTION, which the visible text cannot: what an eye reads as "Milk"
        // has to be heard as something a tap will do.
        <button
          className="shopping-item__tick"
          type="button"
          aria-label={`Mark ${item.name} bought`}
          disabled={busy}
          onClick={() =>
            onPurchaseItem(item.id).then(
              () => {},
              () => {},
            )
          }
        >
          <span className="shopping-item__mark" aria-hidden="true">
            ○
          </span>
          {body}
        </button>
      )}

      <span className="shopping-item__actions">
        {/* A bought item is history and offers no Remove: `remove_shopping_item`
            would refuse it anyway — `item already bought` since #368, where
            the delete policy used to match zero rows — and a control that is
            always refused is worse than none. The window between another phone
            buying the item and this one re-reading is real, and it is settled
            by the database rather than by the client — see App.test.jsx. What
            a bought row offers instead is the way back. */}
        {bought ? (
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            onClick={() =>
              onUnpurchaseItem(item.id).then(
                () => {},
                () => {},
              )
            }
          >
            Not bought after all
          </button>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            aria-label={`Remove ${item.name}`}
            disabled={busy}
            onClick={() =>
              onRemoveItem(item.id).then(
                () => {},
                () => {},
              )
            }
          >
            Remove
          </button>
        )}
      </span>
    </li>
  )
}

ShoppingItem.propTypes = {
  item: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
  timezone: PropTypes.string,
  busy: PropTypes.bool,
  onRemoveItem: PropTypes.func.isRequired,
  onPurchaseItem: PropTypes.func.isRequired,
  onUnpurchaseItem: PropTypes.func.isRequired,
}

/**
 * The confirm's sentence — #357 AC 1.
 *
 * It names the CONSEQUENCE rather than asking "are you sure", because the
 * thing a person needs to know before an irreversible tap is what happens to
 * the items they did not find. At zero it says so in as many words instead of
 * printing a nought: "0 items not bought will carry over" is a sentence about
 * nothing that still has to be read as one.
 */
function finishQuestion(carryCount) {
  if (carryCount === 0) return 'Finish this run? Nothing carries over.'
  const items = carryCount === 1 ? '1 item' : `${carryCount} items`
  return `Finish this run? ${items} not bought will carry over to the next list.`
}

/**
 * "Done shopping", and the two-step confirm in front of it — #357.
 *
 * Mounted with `key={run.id}` by the caller, which is what resets it: a finish
 * that succeeds returns a NEW run, the key changes, and this remounts closed.
 * A finish that is REFUSED leaves the run where it was, so the confirm stays
 * open under the error strip with both ways out still on screen — which is the
 * right end state for a refusal the person may want to retry.
 */
function FinishRun({ runId, carryCount, busy, onFinishRun }) {
  const [confirming, setConfirming] = useState(false)
  const keepRef = useRef(null)

  // AC 6 — the confirm appears with focus on the way OUT. Without this the
  // focus stays on a button that no longer exists and a keyboard user lands
  // wherever the browser puts them next, which on this markup is "Finish".
  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])

  if (!confirming) {
    return (
      <div className="shopping-finish">
        <div className="row row--end">
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Done shopping
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shopping-finish">
      <p className="shopping-finish__question">{finishQuestion(carryCount)}</p>
      <div className="row row--end">
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() =>
            // Both arms empty, for CreateListForm's reason: on success the
            // re-read replaces this run with the one the server opened, and on
            // a refusal App's mutate() has already put the message in the
            // strip. Nothing here is patched from the answer.
            onFinishRun(runId).then(
              () => {},
              () => {},
            )
          }
        >
          Finish
        </button>
        <button
          ref={keepRef}
          className="button button--quiet"
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep shopping
        </button>
      </div>
    </div>
  )
}

FinishRun.propTypes = {
  runId: PropTypes.string.isRequired,
  carryCount: PropTypes.number.isRequired,
  busy: PropTypes.bool,
  onFinishRun: PropTypes.func.isRequired,
}

/**
 * One item on a closed run — one line, and nothing to press — #359 AC 2.
 *
 * Not `ShoppingItem` with its controls disabled, and not the working row struck
 * through: those were both considered and both say "this is a list you could
 * act on, and cannot". What a person reads back is a record, so the row is the
 * three facts it holds — the name, the note somebody left, and what became of
 * it. `purchasedLabel` is #355's own sentence, reused rather than reworded, so
 * a bought item reads the same words on the shelf and in the history.
 */
function PastItem({ item, timezone }) {
  const stamp = item.purchased_at
    ? purchasedLabel(item.purchased_at, item.boughtByName, timezone)
    : null

  return (
    <li className="shopping-past__item">
      <span className="shopping-past__item-name">{item.name}</span>
      {item.note ? <span className="shopping-past__item-note">{item.note}</span> : null}
      <span className="shopping-past__item-fate">
        {/* Two states and no third: an item on a CLOSED run was either bought
            on it or carried into the next one, because `0033` copies every
            unbought item forward as it closes. "carried over" is the same word
            the finish confirm used before the tap, deliberately — the sentence
            a person agreed to is the sentence they read afterwards. A stamp
            that will not parse falls back to it rather than printing an
            Invalid Date, which is also the only way `purchasedLabel` can
            answer null here. */}
        {stamp ?? 'carried over'}
      </span>
    </li>
  )
}

PastItem.propTypes = {
  item: PropTypes.object.isRequired,
  timezone: PropTypes.string,
}

/**
 * Every finished run of the list on screen, behind one disclosure — #359.
 *
 * The read happens on OPEN and it happens HERE, in the `onToggle` of the outer
 * `details`, rather than in an effect keyed on an open flag: the browser's own
 * disclosure is the state, so there is nothing to synchronise and nothing that
 * can draw a frame disagreeing with what the person did. Closing it reads
 * nothing, and opening it again reads again — a person asking twice is a person
 * who wants the current answer.
 *
 * `past` is App's, not this component's, for the reason `selectedListId` is:
 * this component unmounts on a tab switch, and the read that fills it is a
 * network call. It arrives as `{ loading, loaded, runs, items }` and the three
 * states a person can see are distinct on purpose — *reading it now*, *there is
 * nothing to show* and *nothing yet asked for* look identical from a bare array
 * and read very differently on a screen.
 *
 * Filtered to THIS list by `groupClosedRuns`'s grouping rather than trusted: the
 * read names one list, but a switch between two lists while a read is in flight
 * would otherwise draw the other list's trips under this one's name.
 */
function PastRuns({ list, past, members, timezone, onOpenPastRuns }) {
  const group = groupClosedRuns(past.runs, past.items, members).find(
    (entry) => entry.listId === list.id,
  )
  const runs = group?.runs ?? []

  return (
    <details
      className="shopping-past"
      onToggle={(e) => {
        // THE TARGET CHECK IS LOAD-BEARING, and it is the one thing in this
        // file that jsdom could not have told us. `toggle` does not bubble, so
        // React attaches it at the root and SIMULATES bubbling — which means a
        // RUN's own disclosure opening arrives here as though this element had
        // been toggled. Without this line, the newest run mounting with
        // `open={index === 0}` fired a toggle, which re-read, which unmounted
        // and remounted the runs, which fired another: *measured in Chrome at
        // 360x800*, one tap on Past runs produced **55 toggle events in 1.5 s**
        // — an unbounded read loop against the network — and the screen sat on
        // "Reading the finished runs…" forever. The jsdom suite showed exactly
        // one call, and was right about every other thing it asserted.
        if (e.target !== e.currentTarget) return
        if (!e.currentTarget.open) return
        onOpenPastRuns(list.id).then(
          () => {},
          () => {},
        )
      }}
    >
      <summary className="shopping-past__summary">Past runs</summary>

      {past.loading ? <p className="card__body">Reading the finished runs…</p> : null}

      {past.loaded && runs.length === 0 ? (
        <p className="card__body">No finished runs yet</p>
      ) : null}

      {runs.map((run, index) => (
        // `Done.jsx`'s idiom: the newest opens and every earlier one sits behind
        // its heading. React rewrites `open` only when the prop changes, and it
        // changes only when a different run becomes newest, so a person's own
        // toggling of an older run survives a re-read.
        <details className="shopping-past__run" key={run.id} open={index === 0}>
          <summary className="shopping-past__run-summary">
            <h4 className="card__subheading">
              {finishedLabel(run.closedAt, run.closedByName, timezone)}
            </h4>
            {/* Items, never people (#35 AC 9). The two numbers are what a
                closed heading has to answer for the run to be worth opening. */}
            <span className="shopping-past__count">
              {run.bought} bought, {run.carried} carried over
            </span>
          </summary>
          <ul className="shopping-past__items">
            {run.items.map((item) => (
              <PastItem key={item.id} item={item} timezone={timezone} />
            ))}
          </ul>
        </details>
      ))}
    </details>
  )
}

PastRuns.propTypes = {
  list: PropTypes.object.isRequired,
  past: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
  timezone: PropTypes.string,
  onOpenPastRuns: PropTypes.func.isRequired,
}

/** One list: its heading, the items on its open run, and the add form. */
function ShoppingList({
  list,
  run,
  items,
  members,
  past,
  timezone,
  busy,
  soleList,
  onAddItem,
  onRemoveItem,
  onPurchaseItem,
  onUnpurchaseItem,
  onRenameList,
  onArchiveList,
  onUnarchiveList,
  onFinishRun,
  onOpenPastRuns,
}) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [complaint, setComplaint] = useState(null)

  // #355 — unbought first in added order, bought below in purchase order. The
  // rendered order is this array's order, and the count under the heading is
  // derived from the same rows, so the number and the list cannot disagree.
  const ordered = orderShoppingItems(items)
  const left = ordered.filter((item) => !item.purchased_at).length
  // #360 — the one flag that turns this section from a working list into a
  // record. Everything it switches off is switched off because `0035` would
  // refuse the write behind it, so nothing here is a control being hidden from
  // somebody who could otherwise have used it.
  const archived = Boolean(list.archived_at)

  return (
    // #358 — named by the LIST rather than by whatever element is currently
    // drawing its name. `aria-labelledby` pointed at the heading, which the
    // rename editor replaces, so mid-edit the region was announced as "List
    // name" — the field's label, standing in for the region's. The name of a
    // region is not allowed to depend on which of its controls is open.
    <section className="shopping-list" aria-label={list.name}>
      {/* The list's name is the heading and stays the heading: it is the
          region's accessible name, and folding a changing count into it would
          rename the region on every tick. The count is its own line under it —
          unless the picker is drawing it (#358), which is what `showCount`
          says. */}
      <ListHeading
        list={list}
        busy={busy}
        showName={soleList}
        onRenameList={onRenameList}
        onArchiveList={onArchiveList}
        onUnarchiveList={onUnarchiveList}
      />

      {/* #360 — what an archived list IS, in one line, because the absence of
          everything below it would otherwise read as a list that failed to
          load. It says what a tap on Unarchive would buy rather than "this is
          archived", which the picker already said. */}
      {archived ? (
        <p className="shopping-archived">
          Put away. Bring it back to add to it again; everything it bought is still below.
        </p>
      ) : null}

      {/* The `!archived` here is UNREACHABLE and kept on purpose — *measured*,
          dropping it reddens nothing against any valid fixture, because an
          archived list's open run is empty by `0035`'s precondition and so
          `ordered.length > 0` is false for every archived list the database can
          produce. Recorded rather than removed for two reasons: it says what
          the branch is for, and it is the line that would matter first if the
          archive precondition were ever loosened to admit bought items. The
          same shape as the `if (error)` in the scroll effect above. */}
      {!archived && soleList && run && ordered.length > 0 ? (
        <p className="shopping-count">{leftToBuy(left)}</p>
      ) : null}

      {/* A list with no open run is a state nothing writes today —
          create_shopping_list opens the first run in the same transaction, and
          the finish RPC (#354) opens the next — but the read model admits it,
          and a list that vanished from the screen would be worse than one that
          says so. Not said of an archived list: there is nothing to shop from
          either way, and the line above has already said which. */}
      {!archived && !run ? <p className="card__body">This list has no open run.</p> : null}

      {!archived && run && items.length === 0 ? (
        <p className="card__body">Nothing to buy yet.</p>
      ) : null}

      {!archived && ordered.length > 0 ? (
        <ul className="shopping-items">
          {ordered.map((item) => (
            <ShoppingItem
              key={item.id}
              item={item}
              members={members}
              timezone={timezone}
              busy={busy}
              onRemoveItem={onRemoveItem}
              onPurchaseItem={onPurchaseItem}
              onUnpurchaseItem={onUnpurchaseItem}
            />
          ))}
        </ul>
      ) : null}

      {/* #357 AC 4 — an empty run offers no way to finish: there is nothing to
          close and nothing to carry, and a control whose only outcome is an
          identical empty run is worse than no control (the same rule that
          keeps Remove off a bought row).

          DIRECTLY UNDER THE LIST, above the add form, which is the one place
          this file departs from the app's actions-after-everything order —
          owner decision at #357's design pass, on a measurement. A bought row
          sinks, so the last row a shopper ticks is near the TOP of the list,
          and with the control under the two-field add form finishing a
          twelve-item trip meant scrolling 1,700px back down (page 2,339px,
          control at y=2,177 at 360x800). Adding an item is the least urgent
          thing in a store; finishing is what the person came to this end of
          the screen to do.

          Keyed on the run, which is what closes the confirm after a finish —
          see FinishRun's docblock. */}
      {!archived && run && ordered.length > 0 ? (
        <FinishRun
          key={run.id}
          runId={run.id}
          carryCount={left}
          busy={busy}
          onFinishRun={onFinishRun}
        />
      ) : null}

      {!archived && run ? (
        <form
          className="stack shopping-add"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            let clean
            try {
              clean = normalizeName(name)
            } catch (err) {
              // The refusal happens here, before onAddItem is ever called, so
              // an empty name never becomes a request.
              setComplaint(err.message)
              return
            }
            setComplaint(null)
            onAddItem(run.id, clean, noteOrNull(note)).then(
              () => {
                // Cleared only once the write AND the re-read have landed —
                // App's mutate() resolves after both — so the form empties at
                // the moment the item appears in the list above it, and never
                // before. On a refusal the text stays where it was typed.
                setName('')
                setNote('')
              },
              () => {},
            )
          }}
        >
          <label className="field">
            <span className="field__label">Item</span>
            <input
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="Milk"
            />
          </label>
          <label className="field">
            <span className="field__label">Note or quantity</span>
            <input
              className="field__input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder="2 litres, the blue one"
            />
          </label>
          {complaint ? (
            <p className="error" role="alert">
              {complaint}
            </p>
          ) : null}
          <button className="button" type="submit" disabled={busy}>
            Add item
          </button>
        </form>
      ) : null}

      {/* #359 — the record, at the foot of the list and below the add form.
          This is the LEAST urgent thing on the tab and it is placed as such:
          #357 moved the finish control above the form because a shopper needs
          it under their thumb, and by exactly that argument looking something
          up afterwards is not a thing anybody does mid-aisle.

          Keyed on the OPEN run, which is what closes it after a finish: the run
          that just closed is now part of the history above it, and a disclosure
          left open would be showing the answer from before the trip ended.
          Re-opening re-reads and picks it up.

          The key is PREFIXED, and that is not decoration: `FinishRun` above is
          keyed on the same run id and they are siblings, so a bare `run.id`
          here made two children of one parent share a key — React warned and
          rendered the finish control THREE times, which App.test.jsx caught by
          finding three "Done shopping" buttons on one list. */}
      <PastRuns
        key={`past-${run?.id ?? 'no-run'}`}
        list={list}
        past={past}
        members={members}
        timezone={timezone}
        onOpenPastRuns={onOpenPastRuns}
      />
    </section>
  )
}

ShoppingList.propTypes = {
  list: PropTypes.object.isRequired,
  run: PropTypes.object,
  items: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  past: PropTypes.object.isRequired,
  timezone: PropTypes.string,
  busy: PropTypes.bool,
  soleList: PropTypes.bool,
  onAddItem: PropTypes.func.isRequired,
  onRemoveItem: PropTypes.func.isRequired,
  onPurchaseItem: PropTypes.func.isRequired,
  onUnpurchaseItem: PropTypes.func.isRequired,
  onRenameList: PropTypes.func.isRequired,
  onArchiveList: PropTypes.func.isRequired,
  onUnarchiveList: PropTypes.func.isRequired,
  onFinishRun: PropTypes.func.isRequired,
  onOpenPastRuns: PropTypes.func.isRequired,
}

export default function Shopping({
  lists,
  archivedCount,
  showArchived,
  onShowArchived,
  runs,
  items,
  members,
  past,
  timezone,
  busy,
  error,
  selectedListId,
  onSelectList,
  onCreateList,
  onRenameList,
  onArchiveList,
  onUnarchiveList,
  onAddItem,
  onRemoveItem,
  onPurchaseItem,
  onUnpurchaseItem,
  onFinishRun,
  onOpenPastRuns,
}) {
  // #358 — the "New list" form is open or it is not, and that is the only
  // state this component holds about several lists. WHICH list is on screen is
  // App's (`selectedListId`), because it has to survive this component
  // unmounting on a tab switch; whether a form is open does not, and a form
  // still open on a return to the tab would be a half-finished thing the person
  // did not leave there.
  const [creating, setCreating] = useState(false)

  // #360 — BRING THE REFUSAL TO THE PERSON WHO CAUSED IT.
  //
  // The error strip is outside every list, at the foot of the tab, which is
  // right: it is the server's refusal and not a judgement of anyone, and #35
  // AC 9 holds the list itself free of alert styling. What that placement costs
  // was never measured until this story, and it is expensive: at 360x800, a
  // refused Archive put the sentence **770px below the control and off screen,
  // with the page not scrolled and nothing at the control changing** — the tap
  // produced an identical screen. The same is true of #358's rename (757px,
  // measured as the control for this finding), which at least leaves its editor
  // open with the typed text; an archive leaves no trace at all.
  //
  // So the strip is scrolled to when it appears, and this is the whole of the
  // fix — the strip does not move, the placement argument is untouched, and
  // every refusal on this surface is covered rather than the two this story
  // added. Owner's call at #360's design pass; #97 set the precedent with
  // `scrollIntoView` on the field a fold had pushed away.
  //
  // `block: 'center'` rather than `'nearest'`, and that was measured too rather
  // than chosen. `nearest` scrolls the minimum, which put the sentence's bottom
  // edge at **800.0 of an 800px viewport** — legible in a screenshot and
  // exactly where a phone's browser chrome and gesture bar sit. `center` leaves
  // it **118px clear of the bottom** on both the archive and the rename
  // refusals, and the extra scrolling costs nothing on a path that has already
  // failed.
  //
  // Guarded with `?.` because jsdom has no `scrollIntoView` — the assertion in
  // Shopping.test.jsx is a scroll request on `Element.prototype`, which is what
  // a DOM-less environment can honestly see.
  //
  // THE `if (error)` IS BELT-AND-BRACES AND NO TEST CAN SEE IT, which is worth
  // saying so the next reader does not read a zero as a coverage hole. Removing
  // it reddens NOTHING — *measured, 0 of 1* — and the mutation is UNREACHABLE
  // rather than uncovered: `errorRef` is attached to the strip, the strip
  // renders only when `error` is truthy, so `errorRef.current` is null in
  // exactly the case the condition excludes and the optional chain
  // short-circuits anyway. It stays because it says what the effect is for.
  // The dependency array is a different matter and IS covered: `[error]` to
  // `[]` reddens the arrival test, which is the one that mounts without a
  // sentence and then receives one.
  const errorRef = useRef(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'center' })
  }, [error])

  // `lists` arrives in the order it is drawn — App orders it by name — so the
  // picker, the fallback in `resolveSelectedListId` and this line agree on what
  // "first" means without any of them sorting a second time.
  const selected = lists.find((list) => list.id === selectedListId) ?? null
  // "Open" is the read's predicate (closed_at is null), and the read returns
  // only open runs — so a list's run is the one row naming it.
  const run = selected ? (runs.find((r) => r.list_id === selected.id) ?? null) : null

  // #360 — `lists` is what this tab DRAWS, which is App's `visibleShoppingLists`
  // and therefore already excludes the archived ones unless the toggle is on. So
  // "the household has no list" is not `lists.length === 0`, and this line is
  // the whole of that distinction: a household that archived its only list would
  // otherwise be shown the first-list form, prefilled "Groceries", under a
  // sentence saying it has no shopping list — while holding one, with its whole
  // history in it.
  const hasAnyList = lists.length > 0 || archivedCount > 0

  return (
    <section className="card" aria-labelledby="shop-heading">
      <h2 id="shop-heading" className="card__heading">
        Shop
      </h2>

      {!hasAnyList ? (
        <CreateListForm
          busy={busy}
          initialName="Groceries"
          intro="No shopping list yet. Name one and it opens empty, ready for whatever the household is out of."
          onCreateList={onCreateList}
        />
      ) : null}

      {lists.length > 1 ? (
        <ListPicker
          lists={lists}
          runs={runs}
          items={items}
          selectedListId={selectedListId}
          busy={busy}
          onSelectList={onSelectList}
        />
      ) : null}

      {/* #360 — under the picker rather than over it, so revealing the archived
          lists extends the row the person is already looking at. Drawn only
          once there is something to reveal, and it carries the count because
          that is what decides whether the tap is worth making. The label says
          what a tap DOES rather than wearing `aria-pressed`: this is one
          control with two jobs, not a member of a group of choices, and the tab
          strip's own rule against borrowing one attribute for two things cuts
          this way too. */}
      {archivedCount > 0 ? (
        <div className="shopping-archived-toggle row row--end">
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            onClick={() => onShowArchived(!showArchived)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        </div>
      ) : null}

      {/* Everything is put away and the toggle is off — a household state that
          exists, and one the tab has to say something about rather than
          rendering a heading with nothing under it. */}
      {lists.length === 0 && archivedCount > 0 ? (
        <p className="card__body">
          Every list is put away. Show them to bring one back, or name a new one.
        </p>
      ) : null}

      {selected ? (
        <ShoppingList
          key={selected.id}
          list={selected}
          run={run}
          items={run ? items.filter((item) => item.run_id === run.id) : []}
          members={members}
          past={past}
          timezone={timezone}
          busy={busy}
          soleList={lists.length === 1}
          onAddItem={onAddItem}
          onRemoveItem={onRemoveItem}
          onPurchaseItem={onPurchaseItem}
          onUnpurchaseItem={onUnpurchaseItem}
          onRenameList={onRenameList}
          onArchiveList={onArchiveList}
          onUnarchiveList={onUnarchiveList}
          onFinishRun={onFinishRun}
          onOpenPastRuns={onOpenPastRuns}
        />
      ) : null}

      {/* Another list, when the household shops somewhere else. Quiet and
          under the list rather than beside the picker: adding a list is the
          rarest thing on this tab and the loudest control on it should stay the
          row. The form replaces the button while it is open, so there is one
          "Create list" on screen and never two. */}
      {hasAnyList ? (
        creating ? (
          <div className="shopping-new">
            <CreateListForm
              busy={busy}
              initialName=""
              onCreateList={(name) =>
                onCreateList(name).then((made) => {
                  setCreating(false)
                  return made
                })
              }
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : (
          <div className="shopping-new row row--end">
            <button
              className="button button--quiet"
              type="button"
              disabled={busy}
              onClick={() => setCreating(true)}
            >
              New list
            </button>
          </div>
        )
      ) : null}

      {/* A refused write reports itself on the screen the person is looking
          at, OUTSIDE every list — the same placement Done and Chores use. The
          list is what #35 AC 9 holds free of alert styling, and this is the
          server's refusal, not a judgement of anyone. */}
      {error ? (
        <p className="error" role="alert" ref={errorRef}>
          {error}
        </p>
      ) : null}
    </section>
  )
}

Shopping.propTypes = {
  // #360 — the lists this tab DRAWS, which App has already filtered by the
  // toggle below. `archivedCount` is how many it withheld, and it is a count
  // rather than the rows because nothing here draws a hidden list: it decides
  // whether the toggle exists and whether "no list yet" is true.
  lists: PropTypes.array.isRequired,
  archivedCount: PropTypes.number.isRequired,
  showArchived: PropTypes.bool,
  onShowArchived: PropTypes.func.isRequired,
  runs: PropTypes.array.isRequired,
  items: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  // #359 — the finished runs, or the fact that nobody has asked for them yet.
  // App's, because the read happens on a disclosure and this component unmounts
  // whenever another tab is chosen.
  past: PropTypes.object.isRequired,
  timezone: PropTypes.string,
  busy: PropTypes.bool,
  error: PropTypes.string,
  selectedListId: PropTypes.string,
  onSelectList: PropTypes.func.isRequired,
  onCreateList: PropTypes.func.isRequired,
  onRenameList: PropTypes.func.isRequired,
  onArchiveList: PropTypes.func.isRequired,
  onUnarchiveList: PropTypes.func.isRequired,
  onAddItem: PropTypes.func.isRequired,
  onRemoveItem: PropTypes.func.isRequired,
  onPurchaseItem: PropTypes.func.isRequired,
  onUnpurchaseItem: PropTypes.func.isRequired,
  onFinishRun: PropTypes.func.isRequired,
  onOpenPastRuns: PropTypes.func.isRequired,
}
