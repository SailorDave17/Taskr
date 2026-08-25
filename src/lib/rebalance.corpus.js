// The re-balance corpus - story #41 AC 2 and AC 5.
//
// This is not a second corpus of households. It is ONE STATED RULE applied to
// the thirteen shapes in `allocation.corpus.js`, and that is deliberate: a
// capacity change hand-picked per shape could be chosen - even honestly, even
// unconsciously - to produce the churn the story wants to see, and then the
// baseline in AC 2 would be measuring the fixture rather than the allocator.
// A uniform rule cannot be tuned. What it costs is realism in individual
// shapes; what it buys is a number nobody can lean on.
//
// The charter's signature moment is "when someone's week gets BUSY, the
// household load visibly re-balances". So the change is a capacity CUT, not a
// rise, and it lands on the person whose week getting busy disturbs the split
// most.

/**
 * Someone's week got busy: the largest capacity in the household is halved.
 *
 * The largest, because that is the person the allocator leans on hardest - the
 * split is proportional, so the biggest budget is carrying the most minutes and
 * taking half of it away is the perturbation with the most work to redistribute.
 * Halved rather than reduced by a fixed number of minutes, because a fixed cut
 * is enormous against a 25-minute budget and a rounding error against a
 * 300-minute one, and the rule has to mean the same thing in every shape.
 *
 * Ties by member id, so the rule is deterministic in a household of equals -
 * the same property `allocate` needs from its own tie-break, for the same
 * reason.
 *
 * Members with no capacity are left alone. They are already out of the split,
 * and halving zero is not a change to anything.
 *
 * Rounded DOWN, so the result is a whole number of minutes. Rounding up would
 * make the cut smaller than half in odd cases, which is the direction that
 * quietly weakens the perturbation.
 */
export function busyWeek(members) {
  const working = members.filter((m) => m.capacityMinutes > 0)
  if (working.length === 0) return members.map((m) => ({ ...m }))

  let busiest = working[0]
  for (const member of working) {
    if (
      member.capacityMinutes > busiest.capacityMinutes ||
      (member.capacityMinutes === busiest.capacityMinutes &&
        String(member.id).localeCompare(String(busiest.id)) < 0)
    ) {
      busiest = member
    }
  }

  return members.map((member) =>
    member.id === busiest.id
      ? { ...member, capacityMinutes: Math.floor(member.capacityMinutes / 2) }
      : { ...member },
  )
}

/**
 * The change-budget settings the table in docs/rebalance-churn.md reports on -
 * AC 5's "three or more settings", in minutes.
 *
 * Chosen to span the whole tradeoff rather than to bracket a preferred answer:
 * 0 is total stability (nothing discretionary moves at all), Infinity is the
 * stabilised allocator with no bound on it, and the three in between are the
 * range a household would plausibly accept losing off their list in one go.
 * A table whose settings all sat near the value being proposed would show a
 * flat line and prove nothing about the shape of the curve.
 */
export const BUDGETS = [0, 30, 60, 120, Infinity]
