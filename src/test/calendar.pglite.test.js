// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #95 — calendar connection and token custody, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — a green run here says nothing whatever about the hosted project,
// because this harness BUILDS the schema it certifies. `0011` was pasted on
// 2026-08-24 and `npm run check:live` was red on `calendar_connections` by
// design until it was; that check, not this file, is the authority on live state.
//
// ===========================================================================
// #95 AC 2 SAYS THE HARNESS CANNOT PROVE GRANTS. IT CAN PROVE THE HALF THAT
// MATTERS, AND THAT HALF IS UNUSUALLY STRONG HERE
// ===========================================================================
//
// The criterion reads "the pglite harness structurally cannot prove grants, so
// the live grant proof lives in the verification story". That is right about one
// direction and wrong about the other, and the difference is worth stating
// because the wrong half is the one this story turns on.
//
// - Proving `service_role` HAS its grants is vacuous here. The stub's
//   `alter default privileges ... grant all` hands every role everything on
//   every new table, so the assertion passes with the grant deleted. That half
//   genuinely does belong to a live check, and the source-level assertion below
//   is the most this file can honestly say about it.
//
// - Proving `authenticated` and `anon` have NOTHING is the opposite: the stub's
//   default is PERMISSIVE, so a table with no explicit `revoke` arrives with
//   `all` granted to both. Every refusal asserted below therefore fails unless
//   `0011`'s revokes are actually there. The harness overstating the platform,
//   which is a weakness everywhere else, is what makes this file's central claim
//   load-bearing.
//
// So the token table's isolation is proven here, on every push, rather than
// deferred. That is the claim #95 AC 2 is actually about — no grant to
// `authenticated` or `anon` — and it is the one whose failure would be silent.
//
// Names are synthetic — see #19.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'

/** Matches `src/lib/calendar.js`'s CALENDAR_CONNECTION_COLUMNS; asserted against the grant below. */
const READABLE = 'id, member_id, scope, connected_at'

const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'

// A pglite test builds a real Postgres in WebAssembly, so vitest's 5000ms
// default testTimeout is a number nobody chose for this suite - it is what you
// get for not setting one. Raised deliberately, and the measurement is why.
//
// Measured 2026-08-24 on repeats.pglite.test.js's heaviest case, which runs its
// whole scenario twice under two pinned session zones and must therefore build
// TWO more databases inside the test body, on top of the one beforeEach already
// built: 3460ms on the dev machine, 7800ms and 8107ms on ubuntu-latest, where it
// timed out. The same test passed in a third CI run, so the runner straddles the
// default - which is the worst place for a limit to sit, because the suite then
// fails about two pushes in three and reads as a real defect each time.
//
// 30s is ~3.7x the worst time actually observed. A genuine hang still fails; it
// fails later, and that is the whole cost of this line.
//
// hookTimeout is deliberately NOT raised. beforeEach builds exactly one database
// in all eight pglite files, none has ever timed out, and leaving it at 10s keeps
// a real signal: a hook over the line means setup got slower, which is a
// different fact from a test doing more work. If one ever fires, raise it on its
// own evidence rather than by symmetry with this.
vi.setConfig({ testTimeout: 30_000 })

describe('connecting a calendar, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, householdB
  let organizerA, memberTwo, outsider

  /** Write a connection as the OWNER — what the Edge Function does as service_role. */
  const connect = async (household, member, scope = FREEBUSY) => {
    await db.query(
      `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope)
       values ($1, $2, $3, $4)`,
      [household, member, '1//placeholder-refresh', scope],
    )
    await db.query(
      `insert into public.calendar_connections (household_id, member_id, scope)
       values ($1, $2, $3)`,
      [household, member, scope],
    )
  }

  const countAsOwner = async (table) => {
    const { rows } = await db.query(`select count(*)::int as n from public.${table}`)
    return rows[0].n
  }

  /** The privileges a role actually holds on a table, per Postgres itself. */
  const grantsFor = async (role, table) => {
    const { rows } = await db.query(
      `select distinct privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee = $2`,
      [table, role],
    )
    return rows.map((r) => r.privilege_type).sort()
  }

  /** Column-level SELECT privileges, which `table_privileges` cannot see. */
  const readableColumns = async (role, table) => {
    const { rows } = await db.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = $1
          and grantee = $2 and privilege_type = 'SELECT'
        order by column_name`,
      [table, role],
    )
    return rows.map((r) => r.column_name)
  }

  const seedMember = async (household, name, email = null) => {
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes, email)
       values ($1, $2, 60, $3) returning id`,
      [household, name, email],
    )
    return rows[0].id
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db, 'placeholder.organizer@example.test')
    deviceB = await newDevice(db, 'placeholder.other@example.test')

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    householdB = await asDevice(db, deviceB, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })

    organizerA = householdA.organizer_member_id
    memberTwo = await seedMember(householdA.id, 'Placeholder Two')
    outsider = householdB.organizer_member_id
  })

  // -------------------------------------------------------------------------
  // The token table: unreachable, and unreachable twice over
  // -------------------------------------------------------------------------

  describe('AC 2 — no client can read the refresh token', () => {
    it.each(['authenticated', 'anon'])('%s holds NO privilege of any kind on it', async (role) => {
      // The load-bearing assertion of this file. The stub grants `all` on every
      // new table to every role, so an empty result here is only possible
      // because `0011` revokes — delete that line and this goes red.
      expect(await grantsFor(role, 'calendar_tokens')).toEqual([])
      expect(await readableColumns(role, 'calendar_tokens')).toEqual([])
    })

    it('and a signed-in member is refused when they try anyway', async () => {
      await connect(householdA.id, organizerA)
      const refused = await asDevice(db, deviceA, () =>
        attempt(() => db.query('select refresh_token from public.calendar_tokens')),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })

    it('POSITIVE CONTROL: the same caller CAN read the connection table', async () => {
      // Without this, the refusal above is satisfied by a caller with no
      // privileges at all, a broken fixture, or a database that refuses
      // everything — none of which would say anything about this table.
      await connect(householdA.id, organizerA)
      const allowed = await asDevice(db, deviceA, () =>
        attempt(() => db.query(`select ${READABLE} from public.calendar_connections`)),
      )
      expect(allowed.ok, allowed.error ?? '').toBe(true)
      expect(allowed.value.rows).toHaveLength(1)
    })

    it('has row-level security on with NO policy, so a stray grant still finds nothing', async () => {
      // Belt AND braces, deliberately: the grant is the wall, and this is the
      // second, independent one. `enable row level security` with no policy
      // denies every row to every non-bypassing role, so a future migration that
      // grants select here by accident still reaches nothing. Two mistakes would
      // be needed rather than one.
      const { rows: rls } = await db.query(
        `select relrowsecurity from pg_class where oid = 'public.calendar_tokens'::regclass`,
      )
      expect(rls[0].relrowsecurity).toBe(true)

      const { rows: policies } = await db.query(
        `select policyname from pg_policies
          where schemaname = 'public' and tablename = 'calendar_tokens'`,
      )
      expect(policies).toEqual([])
    })

    it('POSITIVE CONTROL: the policy query DOES find the connection table’s policy', async () => {
      // An empty result reads as a clean bill of health, and this is what stops
      // the assertion above passing against a query that finds nothing anywhere.
      const { rows } = await db.query(
        `select policyname from pg_policies
          where schemaname = 'public' and tablename = 'calendar_connections'`,
      )
      expect(rows.map((r) => r.policyname)).toEqual(['calendar_connections_select_same_household'])
    })
  })

  // -------------------------------------------------------------------------
  // The connection table: readable inside the household, and read-only
  // -------------------------------------------------------------------------

  describe('AC 5 — the status the client may read, and only that', () => {
    it('grants exactly the columns `calendar.js` selects, and no more', async () => {
      // The constant and the grant compared directly, the same device
      // migrations.pglite.test.js uses for `members`. A constant that has quietly
      // fallen behind the schema reads exactly like one that has not.
      const granted = await readableColumns('authenticated', 'calendar_connections')
      const used = READABLE.split(',').map((c) => c.trim()).sort()
      expect(granted).toEqual(used)
    })

    it('withholds household_id, so `select *` FAILS rather than returning a subset', async () => {
      // The side effect that matters, and 0003, 0005 and 0010 all rely on it: a
      // forgotten column list is a loud error instead of a quiet superset.
      await connect(householdA.id, organizerA)
      const refused = await asDevice(db, deviceA, () =>
        attempt(() => db.query('select * from public.calendar_connections')),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })

    it('shows a housemate’s connection, because the household is the trust boundary', async () => {
      // Same call the roster makes. Seeing that a housemate has connected a
      // calendar is the same class of fact as seeing their weekly minutes, which
      // the roster has always shown.
      await connect(householdA.id, memberTwo)
      const seen = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.calendar_connections`)
        return rows
      })
      expect(seen.map((r) => r.member_id)).toEqual([memberTwo])
    })

    it('shows NOTHING of another household’s', async () => {
      await connect(householdB.id, outsider)
      const seen = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.calendar_connections`)
        return rows
      })
      expect(seen).toEqual([])
      // And the row is really there — otherwise this passes against a fixture
      // that never wrote one.
      expect(await countAsOwner('calendar_connections')).toBe(1)
    })

    it.each(['insert', 'update', 'delete'])('refuses a client %s — the function owns the write', async (verb) => {
      // No policy and no grant for anything but select. `calendar_connections`
      // is a REPORT of what the Edge Function did; a client that could write it
      // could claim a connection that does not exist, and #96's busy figure
      // would then be drawn for a member with no token behind it.
      await connect(householdA.id, organizerA)
      const statements = {
        insert: [
          `insert into public.calendar_connections (household_id, member_id, scope)
           values ($1, $2, $3)`,
          [householdA.id, memberTwo, FREEBUSY],
        ],
        update: [`update public.calendar_connections set scope = 'x'`, []],
        delete: ['delete from public.calendar_connections', []],
      }
      const [sql, args] = statements[verb]
      const refused = await asDevice(db, deviceA, () => attempt(() => db.query(sql, args)))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })
  })

  // -------------------------------------------------------------------------
  // The shape of the rows
  // -------------------------------------------------------------------------

  describe('one connection per person, in the household they belong to', () => {
    it('refuses a second connection for the same member', async () => {
      // Re-connecting is a CORRECTION of the same fact, which is why the Edge
      // Function upserts on this key. Without the constraint the upsert would
      // silently become an insert and the table would accumulate live
      // credentials nobody is tracking.
      await connect(householdA.id, organizerA)
      const again = await attempt(() =>
        db.query(
          `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope)
           values ($1, $2, $3, $4)`,
          [householdA.id, organizerA, '1//second', FREEBUSY],
        ),
      )
      expect(again.ok).toBe(false)
      expect(again.error).toMatch(/calendar_tokens_one_per_member|duplicate key/i)
    })

    it.each(['calendar_connections', 'calendar_tokens'])(
      '%s cannot pair a member with a household they are not in',
      async (table) => {
        // The composite reference. Without it a row could name one family's
        // person and another family's id, and be visible to the wrong household
        // while pointing at somebody they cannot see.
        // Built per table rather than shared with a spare placeholder. The
        // first version passed four parameters to both and left `$3` unused on
        // the connection table, which Postgres refuses with "could not determine
        // data type of parameter" — so the test FAILED, correctly-looking, for a
        // reason that had nothing to do with the constraint under test. A
        // refusal is only evidence when it is the refusal you asked for, which
        // is why the assertion below names the constraint rather than accepting
        // any error at all.
        const [columns, values, args] =
          table === 'calendar_tokens'
            ? [
                '(household_id, member_id, refresh_token, scope)',
                '($1, $2, $3, $4)',
                [householdB.id, organizerA, '1//placeholder', FREEBUSY],
              ]
            : [
                '(household_id, member_id, scope)',
                '($1, $2, $3)',
                [householdB.id, organizerA, FREEBUSY],
              ]
        const crossed = await attempt(() =>
          db.query(`insert into public.${table} ${columns} values ${values}`, args),
        )
        expect(crossed.ok).toBe(false)
        expect(crossed.error).toMatch(new RegExp(`${table}_member_in_household`))
      },
    )

    it('takes both rows with the member when they are removed from the roster', async () => {
      // A credential outliving the person it belongs to is the failure worth
      // preventing here. Contrast 0006, where deleting a member RELEASES their
      // chores rather than destroying them — a chore survives the person, a
      // stored token must not.
      await provisionMember(db, memberTwo, await newDevice(db, 'placeholder.two@example.test'))
      await connect(householdA.id, memberTwo)
      expect(await countAsOwner('calendar_tokens')).toBe(1)

      await db.query('delete from public.members where id = $1', [memberTwo])

      expect(await countAsOwner('calendar_tokens')).toBe(0)
      expect(await countAsOwner('calendar_connections')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // The half this harness genuinely cannot answer, said out loud
  // -------------------------------------------------------------------------

  describe('the service_role grants, which only the source can testify to here', () => {
    const sql = migrationSql('0011_calendar_connection.sql')

    it('names both tables in an explicit grant to service_role', async () => {
      // A SOURCE assertion, and weaker than everything above — stated plainly
      // rather than dressed up. Postgres cannot testify to it in this harness:
      // the stub grants `all` to every role by default, so `service_role` has
      // these privileges whether or not the migration says so, and the runtime
      // check would pass with both lines deleted.
      //
      // It still earns its place, because the platform disagrees with the stub
      // in the direction that breaks the app. On a current Supabase project a
      // new table gives every Data API role `Dxtm` and nothing else — no select,
      // no insert — so an Edge Function holding the service_role key is refused
      // 42501 on its own table. `service_role` bypasses row-level security; it
      // does NOT bypass grants.
      for (const table of ['calendar_connections', 'calendar_tokens']) {
        expect(sql).toMatch(new RegExp(`grant[^;]*on public\\.${table}[^;]*to service_role`))
      }
    })

    it('POSITIVE CONTROL: the same scan finds no such grant where none was written', async () => {
      // Without this the assertion above passes against a pattern that matches
      // anything — and a source-text guard that cannot say no is decoration.
      // `0010` deliberately grants service_role nothing, so it is the honest
      // negative case rather than an invented one.
      const older = migrationSql('0010_chore_exclusions.sql')
      expect(older).not.toMatch(/grant[^;]*on public\.chore_exclusions[^;]*to service_role/)
    })

    it('revokes before it grants, on both tables', async () => {
      // Ordering is load-bearing on a re-paste: a `grant` followed by a `revoke`
      // leaves the table closed to the role that needs it, and this file is
      // pasted by hand more than once by design.
      for (const table of ['calendar_connections', 'calendar_tokens']) {
        const revokeAt = sql.indexOf(`revoke all on public.${table}`)
        const grantAt = sql.search(new RegExp(`grant[^;]*on public\\.${table}[^;]*to service_role`))
        expect(revokeAt, `no revoke for ${table}`).toBeGreaterThan(-1)
        expect(grantAt).toBeGreaterThan(revokeAt)
      }
    })
  })

  describe('the constant the client reads with', () => {
    it('is the same list this file asserts against the grant', async () => {
      // Two copies, in two files, and a divergence would be silent: the grant
      // test above would keep passing against its own stale constant while the
      // app asked for a column it is not granted.
      const source = readFileSync(resolve(process.cwd(), 'src/lib/calendar.js'), 'utf8')
      expect(source).toContain(`CALENDAR_CONNECTION_COLUMNS = '${READABLE}'`)
    })
  })
})
