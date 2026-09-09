import PropTypes from 'prop-types'

/**
 * WHICH household the data on screen belongs to, and — for somebody who
 * belongs to more than one — the way to another. #164.
 *
 * #163 put the name here as a paragraph and said in band that the switcher
 * "attaches here later with no layout change". This is that attachment, and the
 * no-layout-change half is a constraint rather than a courtesy: the tab strip
 * below fits five tabs into 263.2px of inner width at exactly 8px of horizontal
 * padding (#350's measurement, pinned by gate.test.js), so anything added to
 * this row competes with a control that has no slack left. The switcher
 * therefore REPLACES the paragraph rather than sitting beside it.
 *
 * ONE household renders exactly what #163 rendered — the same element, the same
 * class, the same text (#164 AC 3). That is not an optimisation. Under one
 * household there is nothing to choose, and a disabled or single-option control
 * would tell a person who has one household that there is somewhere else to be.
 * Every household in this app starts as somebody's only one.
 */
export default function HouseholdSwitcher({ households, activeId, onChoose, busy = false }) {
  const active = households.find((h) => h.id === activeId) ?? households[0] ?? null
  if (!active) return null

  // #164 AC 3 — the previous story's element, unchanged. Not a `<select>` with
  // one option and not a disabled control: no affordance at all.
  if (households.length < 2) {
    return <p className="shell__household">{active.name}</p>
  }

  return (
    // A native `<select>`, and the reasoning is the phone. This is a choice
    // among a short list of mutually exclusive things, which is the one control
    // every mobile browser already renders as a full-height native picker with
    // a touch target the platform sizes — so it beats a hand-built menu on the
    // axis that matters here and needs no focus trap, no outside-click handling
    // and no `aria-expanded` of our own.
    //
    // `aria-label` rather than a visible `<label>`: the control's own selected
    // text IS the household name, so a visible label would put the word
    // "Household" above a control that already says which one, on the one row
    // that has no width to spare.
    <select
      className="shell__household-select"
      aria-label="Household"
      value={active.id}
      disabled={busy}
      onChange={(e) => onChoose(e.target.value)}
    >
      {/* IN THE ORDER THE READ RETURNED — #164 AC 1's "deterministic order",
          which is `listHouseholds()`'s `created_at` then `id`. Not sorted by
          name here: a second ordering in the view would disagree with the one
          the default is taken from, so the household at the top of this list
          would not be the one the app opens on. */}
      {households.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  )
}

HouseholdSwitcher.propTypes = {
  households: PropTypes.array.isRequired,
  activeId: PropTypes.string,
  onChoose: PropTypes.func.isRequired,
  busy: PropTypes.bool,
}
