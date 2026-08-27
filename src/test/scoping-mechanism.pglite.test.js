// @vitest-environment node
//
// Node, not the repo-wide jsdom, for the reason chores.pglite.test.js records:
// PGlite loads its WASM through fetch/Response and jsdom's Response has no
// arrayBuffer() here. Without this line the whole file dies in beforeAll — which
// vitest reports as tests SKIPPED and zero failed, so the run looks empty rather
// than broken.
//
// #157 — WHICH HOUSEHOLD-SCOPING MECHANISM DO THE COLUMN GRANTS PERMIT?
//
// This file is the story's deliverable. It is a test rather than a memo on
// purpose (#157 "Why this shape"): a memo describing grants goes stale the day a
// migration changes one and says nothing, where these assertions re-derive from
// the migration files and go red instead.
//
// It MEASURES and RECOMMENDS. It does not decide, and it adds no migration —
// AC 7. The owner deferred that decision to this report.
//
// ---------------------------------------------------------------------------
// WHAT THIS HARNESS CAN AND CANNOT ANSWER — read before trusting a green run
// ---------------------------------------------------------------------------
//
// pgliteSupabase.js is real Postgres with `set role authenticated`, so COLUMN
// GRANTS ARE REALLY ENFORCED here and every grant assertion below is honest.
//
// It is NOT PostgREST. `.eq()`, resource embedding and `!inner` are PostgREST
// features, and a SQL shim cannot represent them — so AC 1's client-level
// refusal and AC 5's embed question are UNANSWERABLE in this file.
//
// AC 5 requires that limit be stated rather than dressed up as a pass. It is
// stated, and then it is DISCHARGED somewhere this file cannot reach: those two
// were measured against a real PostgREST on a local Supabase stack
// (`npx supabase start` + `supabase db reset`, all 13 migrations applied,
// 2026-08-26). The verbatim results are recorded in POSTGREST_MEASURED below and
// asserted for shape only — they are DATA, not observations this file can retake.
// A future reader wanting to re-take them re-runs the stack; nothing here will
// notice if PostgREST changes its mind.
//
// That split is the point of cairn's `a-suite-can-only-prove-the-environment-it-
// builds`: the pglite harness certifies the environment it constructs, and the
// embed question lives entirely outside it.

import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { freshDatabase, asDevice, newDevice, attempt } from './support/pgliteSupabase.js'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// This file boots THREE databases, not one: the shared `beforeAll` instance plus
// a private one for each of the two AC 2 grant simulations, which cannot share
// state without one test's cleanup masking another's mutation (see the comment on
// those tests — the mutation pass measured exactly that). At the measured p90 of
// ~6.2s per boot, and ~9.7s under CPU contention, 30s is the house value and
// still leaves headroom for three.
vi.setConfig({ testTimeout: 30_000 })

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const migrationsDir = join(repoRoot, 'supabase', 'migrations')

// ---------------------------------------------------------------------------
// Measured against a REAL PostgREST, 2026-08-26. Not reproducible from this file.
// ---------------------------------------------------------------------------
//
// Verbatim, from a local stack with every migration applied and one auth user
// holding member rows in TWO households.
export const POSTGREST_MEASURED = Object.freeze({
  // The defect the whole goal exists to fix, observed rather than argued.
  unfilteredMembersRead: {
    query: "client.from('members').select('id, display_name, created_at')",
    rows: 2,
    error: null,
    note: 'rows from BOTH households — this is the silent merge, on real PostgREST',
  },
  // AC 1 — verbatim.
  eqOnMembers: {
    query: "client.from('members').select('id, display_name').eq('household_id', h1)",
    error: 'permission denied for table members',
    code: '42501',
    hint: 'Grant the required privileges to the current role with: GRANT SELECT ON public.members TO authenticated;',
  },
  eqOnChores: {
    query: "client.from('chores').select('id, title').eq('household_id', h1)",
    error: 'permission denied for table chores',
    code: '42501',
  },
  // AC 5 — and the first answer is a decoy.
  embedWithoutDisambiguation: {
    query: "members.select('id, display_name, households!inner(id)').eq('households.id', h1)",
    error: "Could not embed because more than one relationship was found for 'members' and 'households'",
    code: 'PGRST201',
    why:
      'TWO foreign keys relate these tables — members_household_id_fkey (members.household_id -> ' +
      'households.id) and households_organizer_member_id_fkey (households.organizer_member_id -> ' +
      'members.id). A casual test stops here and concludes the problem is ambiguity. It is not.',
  },
  embedDisambiguatedInner: {
    query:
      "members.select('id, display_name, households!members_household_id_fkey!inner(id)')" +
      ".eq('households.id', h1)",
    error: 'permission denied for table members',
    code: '42501',
  },
  // THE DECISIVE CONTROL: no filter at all, and still refused. So it is the JOIN
  // that needs SELECT on the FK column, not the filter. The embed route cannot
  // avoid the grant, and no amount of query rewriting changes that.
  embedNoFilterAtAll: {
    query: "members.select('id, display_name, households!members_household_id_fkey(id)')",
    error: 'permission denied for table members',
    code: '42501',
    verdict: 'the embed mechanism is DEAD — it needs the same grant the direct filter needs',
  },
})

// ---------------------------------------------------------------------------
// AC 3 — the sites that assert or rely on `select('*')` failing.
// ---------------------------------------------------------------------------
//
// #157 named ten. Measured, only THREE concern `members`; the other seven are
// about tables that keep a withheld column whatever happens here, so they are
// untouched by any option. That is a materially smaller cost than the story
// assumed, and it is the finding that most changes the recommendation.
//
// `narrowerProperty` is what each site would still hold. Per the story: each is
// REWRITTEN to that, never deleted.
export const WILDCARD_SITES = Object.freeze([
  { file: 'src/lib/calendar.js', line: 67, table: 'calendar_connections', affected: false,
    narrowerProperty: 'unchanged — 0011 withholds more than the FK column' },
  { file: 'src/lib/capacity.js', line: 36, table: 'member_capacity', affected: false,
    narrowerProperty: 'unchanged — 0005 withholds more than the FK column' },
  { file: 'src/lib/chores.js', line: 37, table: 'chores', affected: false,
    narrowerProperty: 'unchanged — repeat_since and repeat_caught_up_through stay withheld' },
  { file: 'src/lib/exclusions.js', line: 58, table: 'chore_exclusions', affected: false,
    narrowerProperty: 'unchanged — 0010 withholds more than the FK column' },
  { file: 'src/lib/household.js', line: 262, table: 'members', affected: true,
    narrowerProperty:
      'becomes "the grant is per column and adding a column is a decision" — the wildcard no ' +
      'longer refuses, so the comment must stop claiming it does' },
  { file: 'src/test/grants.pglite.test.js', line: 265, table: 'households', affected: false,
    narrowerProperty: 'unchanged — households deliberately grants every column already' },
  { file: 'src/test/capacity.pglite.test.js', line: 507, table: 'households', affected: false,
    narrowerProperty: 'unchanged — about households, not members' },
  { file: 'src/test/exclusions.pglite.test.js', line: 598, table: 'chore_exclusions', affected: false,
    narrowerProperty: 'unchanged — chore_exclusions keeps household_id withheld' },
  { file: 'src/test/migrations.pglite.test.js', line: 792, table: 'members', affected: true,
    narrowerProperty:
      'the assertion "refuses select(*) on members" loses its subject entirely. Rewrite to assert ' +
      'the GRANT SHAPE (every column named explicitly) rather than the wildcard refusal — which is ' +
      'what its own comment already says the property should have been' },
  { file: 'src/test/rls.integration.test.js', line: 764, table: 'members', affected: true,
    narrowerProperty:
      'the test is named "household_id cannot be read on members, so select(*) fails outright". ' +
      'Both halves go false together. Rewrite to assert household_id IS readable and that the ' +
      'RLS predicate still scopes rows — the row-level guarantee is the one that survives' },
])

// ---------------------------------------------------------------------------
// AC 6 — the recommendation. One mechanism, with the cost of each.
// ---------------------------------------------------------------------------
export const RECOMMENDATION = Object.freeze({
  recommended: 'grant-select-household-id',
  mechanisms: [
    {
      key: 'grant-select-household-id',
      what: 'grant select (household_id) on members and chores; client filters with .eq()',
      costDays: 0.5,
      cost:
        'One migration (0014), queued behind the unpasted 0013 (#150). Three assertion sites about ' +
        'members must be rewritten to the narrower property they still hold. chores costs NOTHING — ' +
        'measured: select(*) still refuses there afterwards.',
    },
    {
      key: 'definer-rpcs',
      what: 'a security definer read RPC per list, taking the household id',
      costDays: 2,
      cost:
        'No grant reversal and the withholding convention stays intact. Five new RPCs with their own ' +
        'grants and anon revokes, five LIVE_RPCS entries with exact argument names, a bigger ' +
        'migration behind #150, and a function permanently between the client and its most-read ' +
        'table.',
    },
    {
      key: 'postgrest-embed',
      what: 'filter through an embedded households resource, with no grant change',
      costDays: null,
      cost:
        'IMPOSSIBLE. Measured on real PostgREST: an embed with NO FILTER AT ALL is refused 42501, ' +
        'so the JOIN itself needs select on members.household_id. This option does not exist.',
    },
  ],
  because:
    'The embed is dead by measurement rather than by cost, which removes the only option that ' +
    'avoided a migration. Between the two survivors the grant is a quarter the cost, and the ' +
    'property it gives up is smaller than #157 assumed: three sites, not ten, and chores keeps its ' +
    'wildcard refusal for free. A definer RPC in front of the roster is a permanent structural cost ' +
    'paid to preserve one assertion on one table.',
  notADecision:
    'The owner deferred Q1 to this report and this report recommends. Nothing here applies a grant ' +
    'and no migration is added (AC 7).',
})

describe('#157 — which household-scoping mechanism the column grants permit', () => {
  let db
  beforeAll(async () => { db = await freshDatabase() }, 60_000)
  afterAll(async () => { await db?.close?.() })

  // -------------------------------------------------------------------------
  // AC 1 — the refusal, recorded verbatim
  // -------------------------------------------------------------------------

  // #159 RE-POINTED THIS. It measured the REFUSAL that made the decision
  // necessary: as role `authenticated`, a WHERE on `household_id` was denied
  // 42501, because a WHERE clause needs SELECT on the column it names.
  //
  // 0014 granted that column, so the refusal is no longer reproducible - which
  // is the decision being executed, not a regression. The assertion is turned
  // around to prove the grant actually landed and that the WHERE the whole
  // mechanism depends on now works.
  //
  // POSTGREST_MEASURED is NOT re-pointed and must never be: it is captured data
  // from a real PostgREST stack on 2026-08-26, recording the world before the
  // grant. Its `42501`s are the evidence the decision rested on, and rewriting
  // them would destroy the record this file exists to be.
  it('AC1 (re-pointed): the WHERE that was refused 42501 now works, on both tables', async () => {
    const uid = await newDevice(db)
    const members = await attempt(() =>
      asDevice(db, uid, () =>
        db.query('select id from public.members where household_id = gen_random_uuid()'),
      ),
    )
    const chores = await attempt(() =>
      asDevice(db, uid, () =>
        db.query('select id from public.chores where household_id = gen_random_uuid()'),
      ),
    )
    expect(members.ok).toBe(true)
    expect(chores.ok).toBe(true)

    // The measurement that justified the change, kept verbatim and still
    // asserted for shape - this is what it looked like BEFORE 0014.
    expect(POSTGREST_MEASURED.eqOnMembers.code).toBe('42501')
    expect(POSTGREST_MEASURED.eqOnChores.code).toBe('42501')
    expect(POSTGREST_MEASURED.embedNoFilterAtAll.code).toBe('42501')
  })

  // -------------------------------------------------------------------------
  // AC 2 — granting household_id on chores costs nothing
  // -------------------------------------------------------------------------

  // These two SIMULATE a grant, so they must not do it on the shared database.
  //
  // The first draft did, with an unconditional `revoke` in a `finally` — which is
  // not a restore, it is an assumption that the column was ungranted to begin
  // with. Measured: with a mutation that ADDS household_id to the migration's
  // grant list, that `finally` stripped the mutated grant, so every test after
  // this one saw an unmutated database and the asymmetry assertion below stayed
  // green when it should have reddened. The mutation pass found it; a green run
  // never would have. Same family as cairn's
  // `a-mutation-revert-can-discard-the-work`: a restore that reasons about prior
  // state instead of capturing it.
  //
  // A private database per test costs ~1.5s each and cannot leak by construction.

  it('AC2: after granting household_id on chores, select(*) STILL refuses — so that grant is free', async () => {
    const own = await freshDatabase()
    try {
      const uid = await newDevice(own)
      const before = await attempt(() =>
        asDevice(own, uid, () => own.query('select * from public.chores')),
      )
      expect(before.ok).toBe(false)

      await own.exec('grant select (household_id) on public.chores to authenticated')
      const after = await attempt(() =>
        asDevice(own, uid, () => own.query('select * from public.chores')),
      )
      // The whole point: two other columns stay withheld, so the wildcard keeps
      // failing and every comment that says so keeps being true.
      expect(after.ok).toBe(false)
      expect(after.error).toMatch(/permission denied/i)
    } finally {
      await own.close?.()
    }
  })

  // #159 RE-POINTED THIS. It SIMULATED the grant on a private database and
  // asserted the wildcard then succeeded - the predicted cost of the recommended
  // option. 0014 makes that grant real, and `freshDatabase()` applies every
  // migration, so the simulation's own `before` arm is no longer reachable: the
  // column is granted before the test starts.
  //
  // Re-pointed to assert the PREDICTION CAME TRUE. This is the cost side of the
  // decision, now a standing fact rather than a forecast.
  it('AC2 (the cost side, realised): members withholds nothing, so select(*) succeeds', async () => {
    const uid = await newDevice(db)
    const after = await attempt(() =>
      asDevice(db, uid, () => db.query('select * from public.members')),
    )
    expect(after.ok).toBe(true)
  })

  it('AC2: the asymmetry is a property of the grant lists, re-derived from the migrations', async () => {
    // Re-derived rather than asserted from memory, so a migration that changes a
    // grant list reddens this instead of silently invalidating the report.
    const { rows: withheld } = await db.query(`
      select c.relname::text as tbl, a.attname::text as col
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('members','chores')
        and a.attnum > 0 and not a.attisdropped
        and not has_column_privilege('authenticated', c.oid, a.attname, 'SELECT')
      order by c.relname, a.attnum`)

    const byTable = {}
    for (const r of withheld) (byTable[r.tbl] ??= []).push(r.col)

    // #159 RE-POINTED THIS, and it is the single most informative assertion in
    // the file now. Before 0014: members withheld exactly ['household_id'] - one
    // card left to play - and chores withheld that plus two repeat columns. The
    // report's whole recommendation turned on that asymmetry.
    //
    // After 0014 the asymmetry is REALISED rather than predicted: members
    // withholds NOTHING (which is why its wildcard refusal is gone, the cost),
    // and chores still withholds the two repeat columns (which is why its
    // refusal survives, the free half). Both halves asserted, because a change
    // to either one is a change to the decision this file recommended.
    expect(byTable.members ?? []).toEqual([])
    expect(byTable.chores).toEqual(
      expect.arrayContaining(['repeat_since', 'repeat_caught_up_through']),
    )
    expect(byTable.chores).not.toContain('household_id')
    expect(byTable.chores.length).toBeGreaterThan(1)
  })

  // -------------------------------------------------------------------------
  // AC 4 — the three tables that need no grant change at all
  // -------------------------------------------------------------------------

  it('AC4: member_capacity, chore_exclusions and calendar_connections are already scopable', async () => {
    // They grant member_id / chore_id, so they scope from an already-scoped
    // member and chore set with no grant change. Derived, not recalled.
    const { rows } = await db.query(`
      select c.relname::text as tbl, a.attname::text as col
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public'
        and c.relname in ('member_capacity','chore_exclusions','calendar_connections')
        and a.attnum > 0 and not a.attisdropped
        and a.attname in ('member_id','chore_id')
        and has_column_privilege('authenticated', c.oid, a.attname, 'SELECT')
      order by c.relname, a.attname`)

    const granted = new Set(rows.map((r) => `${r.tbl}.${r.col}`))
    expect(granted.has('member_capacity.member_id')).toBe(true)
    expect(granted.has('chore_exclusions.chore_id')).toBe(true)
    expect(granted.has('chore_exclusions.member_id')).toBe(true)
    expect(granted.has('calendar_connections.member_id')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // AC 3 — the ten sites, and which of them the recommendation actually costs
  // -------------------------------------------------------------------------

  it('AC3: every named site exists, and only the members ones are affected', () => {
    for (const site of WILDCARD_SITES) {
      const full = join(repoRoot, site.file)
      expect(existsSync(full), `${site.file} should exist`).toBe(true)
      const lines = readFileSync(full, 'utf8').split(/\r?\n/)
      // The line is a citation, and a citation drifts. Assert the SUBJECT is
      // still near it rather than pinning an exact line number, which cairn
      // records decaying with a two-day half-life.
      const body = lines.join('\n')
      // #159 RE-POINTED THIS. It asserted each site still DISCUSSED the wildcard
      // near its cited line - which was a check that nobody had rewritten them
      // yet. #159 AC 7 is the instruction to rewrite the three affected ones, so
      // the old assertion is satisfied only while the story is undone.
      //
      // The property that survives, and is the one worth guarding: each named
      // FILE still exists and still says something about the subject. An
      // AFFECTED site must now also carry its story marker, which is how a
      // rewrite is told apart from a deletion.
      expect(body, `${site.file} should still discuss the grant or the wildcard`)
        .toMatch(/select\('\*'\)|select \*|wildcard|household_id/i)
      if (site.affected) {
        expect(body, `${site.file} is an affected site and should cite #159`).toMatch(/#159/)
      }
      expect(site.narrowerProperty.length).toBeGreaterThan(20)
    }
    // The finding: 3 of 10, not 10 of 10.
    const affected = WILDCARD_SITES.filter((s) => s.affected)
    expect(affected).toHaveLength(3)
    expect(affected.every((s) => s.table === 'members')).toBe(true)
    expect(WILDCARD_SITES).toHaveLength(10)
  })

  // -------------------------------------------------------------------------
  // AC 5 — the embed, and the limit of this harness
  // -------------------------------------------------------------------------

  it('AC5: the embed mechanism is impossible — the JOIN itself needs the grant', () => {
    // Stated as a limit rather than as a pass, per AC 5: this file CANNOT take
    // this measurement. What it can do is refuse to let the conclusion be
    // reported without its decisive control attached.
    const m = POSTGREST_MEASURED
    expect(m.embedDisambiguatedInner.code).toBe('42501')
    // The control that makes it conclusive: no filter, still refused. Without
    // this, "the filter is refused" is consistent with a fixable query.
    expect(m.embedNoFilterAtAll.query).not.toMatch(/\.eq\(/)
    expect(m.embedNoFilterAtAll.code).toBe('42501')
    // And the decoy is recorded, so nobody re-runs the naive form and concludes
    // the problem is ambiguity.
    expect(m.embedWithoutDisambiguation.code).toBe('PGRST201')
  })

  it('AC5: this harness has no PostgREST, and says so rather than passing vacuously', () => {
    const source = readFileSync(join(here, 'support', 'pgliteSupabase.js'), 'utf8')
    // The harness is a SQL shim. If it ever grows a PostgREST, this reddens and
    // the limit above should be re-examined rather than inherited.
    expect(source).not.toMatch(/postgrest/i)
  })

  // -------------------------------------------------------------------------
  // AC 6 / AC 7 — a recommendation, and no migration
  // -------------------------------------------------------------------------

  it('AC6: recommends exactly one mechanism, and prices all three', () => {
    expect(RECOMMENDATION.recommended).toBe('grant-select-household-id')
    expect(RECOMMENDATION.mechanisms).toHaveLength(3)
    const rec = RECOMMENDATION.mechanisms.find((m) => m.key === RECOMMENDATION.recommended)
    expect(rec).toBeTruthy()
    // The dead option must stay in the list with its verdict, so a later reader
    // does not rediscover it as an idea nobody tried.
    const embed = RECOMMENDATION.mechanisms.find((m) => m.key === 'postgrest-embed')
    expect(embed.costDays).toBeNull()
    expect(embed.cost).toMatch(/IMPOSSIBLE/)
  })

  // #159 RE-POINTED THIS. AC 7 forbade the MEASUREMENT story from taking the
  // decision, and the assertion enforced it: a 0014 appearing would have meant
  // somebody applied a grant inside a story whose job was to price one.
  //
  // #159 is the story that legitimately adds it. So the check is inverted: 0014
  // must exist, and it must grant exactly what this report recommended, on
  // exactly the two tables it named - which turns the report from a forecast
  // into a live guard that the decision was executed as recommended.
  it('AC7 (re-pointed): 0014 exists, and grants exactly what this report recommended', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    const migration = files.find((f) => f.startsWith('0014'))
    expect(migration, 'the recommended grant should have landed as 0014').toBeTruthy()

    const sql = readFileSync(join(migrationsDir, migration), 'utf8')
    const grants = [...sql.matchAll(/grant\s+select\s*\(\s*household_id\s*\)\s+on\s+public\.(\w+)/gi)]
      .map((m) => m[1])
      .sort()
    // The recommended mechanism was `grant-select-household-id` on members and
    // chores. Not one table, not five - the three that scope from an
    // already-scoped member set were measured as needing no grant change.
    expect(grants).toEqual(['chores', 'members'])
    expect(RECOMMENDATION.recommended).toBe('grant-select-household-id')
  })
})
