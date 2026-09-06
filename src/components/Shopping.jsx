import { useState } from 'react'
import PropTypes from 'prop-types'
import { firstNameOf, normalizeName } from '../lib/shopping.js'

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
//   - It does not tick. Marking an item bought, and the ordering that sinks
//     bought items below the rest, is #355 — the moment the epic protects, with
//     its own re-read decision. An item bought by ANOTHER phone still has to be
//     drawn here, because the re-read will return it; it renders as a quiet
//     "bought" mark with no Remove control, and nothing more until #355.
//   - It does not finish a run (#357), pick between lists (#358), show past
//     runs (#359) or archive (#360). Every list the read returns is drawn, in
//     the read's order, so nothing is hidden if a second one exists — but only
//     `create_shopping_list` writes one, and this tab offers it only when there
//     are none, so until #358 a household has one list.
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
// simply has no "added by" line.

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

/** The first list — the household's only one until #358 adds a second. */
function CreateListForm({ busy, onCreateList }) {
  const [name, setName] = useState('Groceries')
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
          setComplaint(err.message)
          return
        }
        setComplaint(null)
        // Two arms, both empty: on success the re-read replaces this form with
        // the list it made, and on failure App's mutate() has already put the
        // message in the strip below. Nothing here is patched from the answer.
        onCreateList(clean).then(
          () => {},
          () => {},
        )
      }}
    >
      <p className="card__body">
        No shopping list yet. Name one and it opens empty, ready for whatever the household is
        out of.
      </p>
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
      <button className="button" type="submit" disabled={busy}>
        Create list
      </button>
    </form>
  )
}

CreateListForm.propTypes = {
  busy: PropTypes.bool,
  onCreateList: PropTypes.func.isRequired,
}

/** One item on the open run. */
function ShoppingItem({ item, members, busy, onRemoveItem }) {
  const bought = Boolean(item.purchased_at)
  const adder = members.find((m) => m.id === item.added_by_member_id)
  const adderName = adder ? firstNameOf(adder.display_name) : null

  return (
    // The bought modifier is conditional, the way `chore--missed` is on the
    // chore row, and the gate's stylesheet check cannot see a conditional
    // class — so `.shopping-item--bought` has its rule in index.css by hand,
    // beside the static ones the check does read.
    <li className={bought ? 'shopping-item shopping-item--bought' : 'shopping-item'}>
      <div className="shopping-item__body">
        <span className="shopping-item__name">{item.name}</span>
        {item.note ? <span className="shopping-item__note">{item.note}</span> : null}
        {adderName || bought ? (
          <span className="shopping-item__meta">
            {adderName ? `added by ${adderName}` : null}
            {adderName && bought ? ' · ' : null}
            {bought ? 'bought' : null}
          </span>
        ) : null}
      </div>
      {/* A bought item is history and offers no Remove: the delete policy
          would refuse it anyway (zero rows), and a control that is always
          refused is worse than none. The window between another phone buying
          the item and this one re-reading is real, and it is settled by the
          policy rather than the client — see App.test.jsx. */}
      {!bought ? (
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
      ) : null}
    </li>
  )
}

ShoppingItem.propTypes = {
  item: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onRemoveItem: PropTypes.func.isRequired,
}

/** One list: its heading, the items on its open run, and the add form. */
function ShoppingList({ list, run, items, members, busy, onAddItem, onRemoveItem }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [complaint, setComplaint] = useState(null)

  return (
    <section className="shopping-list" aria-labelledby={`shopping-list-${list.id}`}>
      <h3 id={`shopping-list-${list.id}`} className="card__subheading">
        {list.name}
      </h3>

      {/* A list with no open run is a state nothing writes today —
          create_shopping_list opens the first run in the same transaction, and
          the finish RPC (#354) opens the next — but the read model admits it,
          and a list that vanished from the screen would be worse than one that
          says so. */}
      {!run ? <p className="card__body">This list has no open run.</p> : null}

      {run && items.length === 0 ? <p className="card__body">Nothing to buy yet.</p> : null}

      {items.length > 0 ? (
        <ul className="shopping-items">
          {items.map((item) => (
            <ShoppingItem
              key={item.id}
              item={item}
              members={members}
              busy={busy}
              onRemoveItem={onRemoveItem}
            />
          ))}
        </ul>
      ) : null}

      {run ? (
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
    </section>
  )
}

ShoppingList.propTypes = {
  list: PropTypes.object.isRequired,
  run: PropTypes.object,
  items: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onAddItem: PropTypes.func.isRequired,
  onRemoveItem: PropTypes.func.isRequired,
}

export default function Shopping({
  lists,
  runs,
  items,
  members,
  busy,
  error,
  onCreateList,
  onAddItem,
  onRemoveItem,
}) {
  return (
    <section className="card" aria-labelledby="shop-heading">
      <h2 id="shop-heading" className="card__heading">
        Shop
      </h2>

      {lists.length === 0 ? <CreateListForm busy={busy} onCreateList={onCreateList} /> : null}

      {lists.map((list) => {
        // "Open" is the read's predicate (closed_at is null), and the read
        // returns only open runs — so a list's run is the one row naming it.
        const run = runs.find((r) => r.list_id === list.id) ?? null
        return (
          <ShoppingList
            key={list.id}
            list={list}
            run={run}
            items={run ? items.filter((item) => item.run_id === run.id) : []}
            members={members}
            busy={busy}
            onAddItem={onAddItem}
            onRemoveItem={onRemoveItem}
          />
        )
      })}

      {/* A refused write reports itself on the screen the person is looking
          at, OUTSIDE every list — the same placement Done and Chores use. The
          list is what #35 AC 9 holds free of alert styling, and this is the
          server's refusal, not a judgement of anyone. */}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

Shopping.propTypes = {
  lists: PropTypes.array.isRequired,
  runs: PropTypes.array.isRequired,
  items: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  error: PropTypes.string,
  onCreateList: PropTypes.func.isRequired,
  onAddItem: PropTypes.func.isRequired,
  onRemoveItem: PropTypes.func.isRequired,
}
