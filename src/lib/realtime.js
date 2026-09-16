import { LIVE_SCHEMA } from './liveSchema.js'
import { getSupabase } from './supabase.js'

/**
 * The app updates itself when the household changes — story #342.
 *
 * Two mechanisms, because they fail differently. A phone that was in a pocket
 * re-reads when its tab comes back (`attachVisibilityRefresh`), which needs
 * nothing from the live project; a phone left open on a counter hears the
 * change over one Supabase Realtime channel (`subscribeToHousehold`), which
 * needs `0037` applied. Both funnel into ONE read queue (`createReadQueue`),
 * so a write's own re-read, its Realtime echo and a focus event that all land
 * in the same second cost one read in flight and at most one more after it.
 *
 * WHAT IS WATCHED, AND WHY IT IS DERIVED. The table list is not written here —
 * it is `LIVE_SCHEMA` minus `UNWATCHED_TABLES`, so a table the client starts
 * reading is watched the day `liveSchema.test.js` forces it into that list,
 * and the publication migration is compared against the same derivation in
 * `src/test/realtime.pglite.test.js`. #342 was filed naming
 * `chore_completions` and `chore_assignments`; neither table exists (both are
 * columns on `chores`), which is the argument for deriving the list rather
 * than copying one out of an issue.
 *
 * HOW A CHANNEL IS FILTERED, AND WHAT REALTIME CAN AND CANNOT SCOPE. Every
 * INSERT and UPDATE is filtered to the household on the server, on a column
 * the subscriber's role may SELECT — Realtime refuses a filter on any other
 * column (`subscription_check_filters`: "invalid column for filter"), which is
 * why the filter column is chosen from the table's OWN client column list and
 * never assumed. Realtime then runs the table's RLS policies per subscriber,
 * so a misfiltered channel is a wasted message rather than a leak.
 *
 * DELETEs are the exception, and it is the platform's rather than this
 * file's: Postgres cannot check a policy against a row that no longer exists,
 * so Realtime applies NO RLS to a delete, and by default the old record
 * carries only the primary key — so a delete never matches a filter on
 * `household_id` or `member_id` and a filtered channel simply never hears it.
 * Setting `replica identity full` would make the filter match and would also
 * send the deleted row's every column to any authenticated subscriber whose
 * filter happened to match, with no policy in the way. So each scoped table
 * carries a SECOND binding: `DELETE`, unfiltered. What it delivers is the
 * deleted row's id and nothing else, to every subscriber of that table under
 * this role; what this device does with it is re-read through the policies
 * it already has. That is the whole of the access decision, and
 * `docs/access-model.md` records it beside the rest.
 */

/** How long after the last focus/visibility event the re-read starts. */
export const REFRESH_DEBOUNCE_MS = 250

/**
 * Tables the client reads and this device deliberately does NOT watch, each
 * with its reason. Asserted complete by `realtime.test.js`: every `LIVE_SCHEMA`
 * table is either watched or named here.
 */
export const UNWATCHED_TABLES = Object.freeze({
  member_split_seen:
    'self-scoped: the row is what THIS member was last shown and only they can read it, ' +
    'so no other phone has news here — and refresh() itself writes it, so watching it ' +
    'would make every read echo into one more read.',
  // #172 — owner decision at pickup, 2026-09-10, over publishing it in a new
  // migration. The cost is stated rather than hidden: a redemption on somebody
  // else's phone reaches the organizer's list on their next refresh (focus,
  // visibility, or any write), not the instant it happens.
  invitations:
    'organizer-only: the one device that may read a row is the one that minted or ' +
    'withdraws it, and publishing would put token_hash on a channel for no other reader — ' +
    'the column 0040 exists to keep scarce.',
})

/** The Realtime publication `0037` fills, by name — one string, asserted against pglite. */
export const REALTIME_PUBLICATION = 'supabase_realtime'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * How a table's changes are scoped to one household on the server:
 *
 *   - `self`       the `households` row itself, by its primary key
 *   - `household`  the table's client column list carries `household_id`
 *   - `member`     it does not, but carries `member_id` (the three tables that
 *                  withhold `household_id` from the client are scoped by the
 *                  roster, exactly as `refresh()` scopes their reads)
 *   - `rls`        neither column is readable, so the server's policies are
 *                  the only scope (`chore_repeat_exceptions`, whose client
 *                  columns are the chore id and a date)
 */
function scopeOf({ table, columns }) {
  if (table === 'households') return 'self'
  const names = columns === '*' ? [] : columns.split(',').map((c) => c.trim())
  if (names.includes('household_id')) return 'household'
  if (names.includes('member_id')) return 'member'
  return 'rls'
}

/** Every table this device listens to, with how each is scoped. */
export const WATCHED_TABLES = Object.freeze(
  LIVE_SCHEMA.filter((entry) => !(entry.table in UNWATCHED_TABLES)).map((entry) =>
    Object.freeze({ table: entry.table, scope: scopeOf(entry) }),
  ),
)

/** The same list, names only. */
export const WATCHED_TABLE_NAMES = Object.freeze(WATCHED_TABLES.map((w) => w.table))

function assertId(value, what) {
  if (!UUID.test(String(value))) {
    // A filter is a string the server parses; an id that is not a uuid could
    // only widen it, so it is refused here rather than sent.
    throw new Error(`${what} must be a uuid to build a Realtime filter, got ${JSON.stringify(value)}`)
  }
}

/** The channel a household's phones share. One per household, per device. */
export function channelNameFor(householdId) {
  assertId(householdId, 'householdId')
  return `household:${householdId}`
}

/**
 * The `postgres_changes` bindings one household channel carries — what the
 * server is asked for, in the exact shape `supabase-js` sends in `phx_join`.
 *
 * Per scoped table: one `*` binding filtered to the household (INSERT and
 * UPDATE, RLS-checked per subscriber), and one unfiltered `DELETE` binding,
 * for the reason in the file docblock. `households` needs no second binding:
 * its filter IS the primary key, which is the one column a delete's old record
 * always carries. An `rls`-scoped table, or a member-scoped one when the roster
 * is not yet known, gets a single unfiltered `*` binding: the policies scope
 * it, and the member filter is added the moment the roster is read.
 */
export function changeBindingsFor({ householdId, memberIds = [] }) {
  assertId(householdId, 'householdId')
  for (const id of memberIds) assertId(id, 'memberIds')
  const bindings = []
  for (const { table, scope } of WATCHED_TABLES) {
    const filter =
      scope === 'self'
        ? `id=eq.${householdId}`
        : scope === 'household'
          ? `household_id=eq.${householdId}`
          : scope === 'member' && memberIds.length
            ? `member_id=in.(${memberIds.join(',')})`
            : null
    if (!filter) {
      bindings.push({ event: '*', schema: 'public', table })
    } else {
      bindings.push({ event: '*', schema: 'public', table, filter })
      if (scope !== 'self') bindings.push({ event: 'DELETE', schema: 'public', table })
    }
  }
  return bindings
}

/**
 * Tells a re-join from the first join.
 *
 * `subscribe()`'s callback reports `SUBSCRIBED` on every successful join,
 * including the first; only the ones after a `CLOSED`, `TIMED_OUT` or
 * `CHANNEL_ERROR` mean the phone was deaf for a while. The first join is not a
 * catch-up: the boot read that just ran is.
 */
export function reconnectDetector() {
  let joined = false
  return (status) => {
    if (status !== 'SUBSCRIBED') return false
    const rejoin = joined
    joined = true
    return rejoin
  }
}

/**
 * One read in flight at a time; a request while one is running schedules
 * EXACTLY one more, and every requester gets the result of a read that started
 * after they asked — #342 AC 5.
 *
 * Why "one more" rather than "none": a read that was already running when the
 * request arrived may have read the table BEFORE the change the request is
 * about, so it cannot satisfy the request; the next one can, and every request
 * that lands while it is queued is satisfied by that same next read.
 */
export function createReadQueue(read) {
  let running = null
  let queued = null

  function request() {
    if (running) {
      if (!queued) queued = deferred()
      return queued.promise
    }
    running = (async () => read())().finally(() => {
      running = null
      const next = queued
      if (next) {
        queued = null
        request().then(next.resolve, next.reject)
      }
    })
    return running
  }

  return {
    request,
    /** For the tests and nothing else: is a read running right now? */
    get inFlight() {
      return running !== null
    },
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Re-read when the tab becomes visible again or the window regains focus —
 * #342 AC 1. Debounced: a return to the tab fires both events within a few
 * milliseconds of each other, and a flurry of them is one read.
 *
 * Returns the detach function, so it drops straight into a `useEffect`.
 */
export function attachVisibilityRefresh(onRefresh, { target = globalThis, debounceMs = REFRESH_DEBOUNCE_MS } = {}) {
  const doc = target.document
  let timer = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onRefresh()
    }, debounceMs)
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') schedule()
  }
  doc.addEventListener('visibilitychange', onVisibility)
  target.addEventListener('focus', schedule)
  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    doc.removeEventListener('visibilitychange', onVisibility)
    target.removeEventListener('focus', schedule)
  }
}

/**
 * Open the household's channel — #342 AC 2 and AC 3.
 *
 * `onChange` fires for every change the server let through; `onReconnect`
 * fires when the channel re-joins after a drop, which is the catch-up for
 * whatever was missed while the socket was down (the phone slept, the network
 * changed). Both are expected to request a read and nothing more — the payload
 * is not used to patch state, because what the next device to load will see
 * is what a re-read shows, and that is the discipline every write here keeps.
 *
 * The session token reaches Realtime on its own: `supabase-js` forwards every
 * auth state change to `realtime.setAuth`, so the subscriber's role is the
 * signed-in member's and the server's per-subscriber RLS check is theirs.
 *
 * Returns `{ close }`; closing removes the channel, and the client disconnects
 * the socket itself once no channel remains.
 */
export function subscribeToHousehold(
  { householdId, memberIds = [], onChange, onReconnect, onStatus },
  client = getSupabase(),
) {
  const channel = client.channel(channelNameFor(householdId))
  for (const binding of changeBindingsFor({ householdId, memberIds })) {
    channel.on('postgres_changes', binding, (payload) => onChange?.(payload))
  }
  const rejoined = reconnectDetector()
  channel.subscribe((status, err) => {
    onStatus?.(status, err)
    if (rejoined(status)) onReconnect?.()
  })
  return {
    channel,
    close: () => client.removeChannel(channel),
  }
}

/**
 * Ask the live project whether ONE table is in the Realtime publication, by
 * doing what a phone does: join a channel on it and read the answer — for
 * `npm run check:live` (#342 AC 6).
 *
 * WHERE THE ANSWER IS, measured against the live project on 2026-09-08 rather
 * than read off a docs page: the server ACKNOWLEDGES THE JOIN FOR ANY TABLE
 * NAME — `chores` while unpublished, `member_split_seen`, and a table that does
 * not exist at all every one answered `phx_reply ok` and reported
 * `SUBSCRIBED` — and only then sends a `system` frame for the
 * `postgres_changes` extension saying whether the subscription took:
 * `status: 'error'` with "Unable to subscribe to changes with given
 * parameters …" for a table outside the publication, `status: 'ok'` for one
 * inside it. A first draft of this probe resolved on `SUBSCRIBED` and read
 * **61 of 62 green with the publication empty**, its own negative control the
 * one red; that is the instrument the file docblock warns about, caught by the
 * control (cairn: `prove-an-instrument-could-have-shown-the-opposite`). So
 * the verdict is the `system` frame, never the join, and a join that is
 * acknowledged and then followed by no frame inside the timeout is
 * `NO_ANSWER` — reported as no evidence, never as a pass.
 *
 * It reads no row: joining inserts nothing into any household's table, and the
 * channel is removed before the verdict is returned.
 */
export function probePublication(client, table, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const channel = client.channel(`check-live:${table}:${Date.now()}`)
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {})
    let settled = false
    let timer = null
    const finish = (verdict) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      Promise.resolve(client.removeChannel(channel))
        .catch(() => {})
        .then(() => resolve(verdict))
    }
    timer = setTimeout(() => finish({ status: 'NO_ANSWER', message: null }), timeoutMs)
    channel.on('system', {}, (frame) => {
      if (frame?.extension && frame.extension !== 'postgres_changes') return
      if (frame?.status === 'ok') finish({ status: 'PUBLISHED', message: frame.message ?? null })
      else if (frame?.status === 'error') {
        finish({ status: 'CHANNEL_ERROR', message: frame.message ?? null })
      }
    })
    channel.subscribe((status, err) => {
      // SUBSCRIBED is deliberately NOT a verdict — see the docblock.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        finish({ status, message: err?.message ?? null })
      }
    })
  })
}

/**
 * One line naming what is wrong with a table's publication probe, or null
 * when the table is published. The classification is pinned by
 * `realtime.test.js`, so a refusal cannot quietly become "ok".
 */
export function describePublicationError(table, probe) {
  const { status, message } = probe
  if (status === 'PUBLISHED') return null
  if (status === 'CHANNEL_ERROR' && /unable to subscribe/i.test(message ?? '')) {
    return (
      `${table}: NOT PUBLISHED — the live project's \`${REALTIME_PUBLICATION}\` publication does not ` +
      `carry it, so no phone hears a change to it. \`0037\` never ran: ` +
      `\`npm run migrate:live supabase/migrations/0037_realtime_publication.sql\`. ` +
      `Realtime said: ${message}`
    )
  }
  if (status === 'CHANNEL_ERROR') {
    return (
      `${table}: the Realtime join was refused for a reason other than the publication — ` +
      `${message ?? 'no message'}. Not evidence about \`0037\` either way; read the message.`
    )
  }
  if (status === 'TIMED_OUT' || status === 'NO_ANSWER') {
    return (
      `${table}: Realtime did not say whether the subscription took (${status}) — no \`system\` ` +
      `frame for postgres_changes arrived in time. A network or Realtime-service fault, not ` +
      `evidence about \`0037\` either way — run it again before reading it as red.`
    )
  }
  if (status === 'SUBSCRIBED') {
    // The join alone, which the server acknowledges for ANY table name. A
    // caller that hands this in has read the wrong frame.
    return `${table}: the join was acknowledged, which the server does for any table name; that is not a verdict.`
  }
  return `${table}: the join ended in an unexpected state, ${status}${message ? ` (${message})` : ''}.`
}
