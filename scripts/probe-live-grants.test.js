import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LIVE_TABLES } from '../src/lib/liveSchema.js'
import {
  MEASURED_GRANTS,
  SUBJECT_ROLE,
  assertReadOnly,
  attaclQuery,
  nameList,
  privilegesFor,
  probeTables,
  reconcile,
  relaclQuery,
  sqlIdentifier,
} from './probe-live-grants.mjs'

// `npm run probe:live-grants` — #185 AC 3 and AC 4.
//
// The half these tests can settle is the half that decides WHAT IS ASKED and HOW
// AN ANSWER IS READ. Whether the live project answers as #150 measured is AC 4,
// and no fixture can stand in for it: a fake catalog would be built from the same
// expectation it is being compared against, so it would agree by construction.
// The reconciliation below is therefore driven with rows that DISAGREE as well as
// rows that agree, because a comparator that always says yes and a comparator
// that is right look identical when fed only correct data.

describe('the probe cannot write, and the claim is enforced rather than asserted', () => {
  it('both queries pass the read-only guard', () => {
    expect(() => relaclQuery([...LIVE_TABLES])).not.toThrow()
    expect(() => attaclQuery([...LIVE_TABLES])).not.toThrow()
  })

  it('POSITIVE CONTROL: the guard refuses each write verb, so it is not decoration', () => {
    // Without this, a typo in the pattern leaves a guard that passes everything —
    // and it would pass everything quietly, which is the failure mode that
    // matters. Every verb is exercised, so none can become a dead entry.
    for (const statement of [
      'insert into t values (1)',
      'update t set a = 1',
      'delete from t',
      'drop table t',
      'alter table t add column c int',
      'create table t (a int)',
      'truncate t',
      'grant select on t to authenticated',
      'revoke select on t from anon',
      'refresh materialized view v',
      'call p()',
      'do $$ begin end $$',
    ]) {
      expect(() => assertReadOnly(statement), statement).toThrow(/write verb/)
    }
  })

  it('does not fire on a column whose NAME contains a verb', () => {
    // `updated_at` must not read as `update`, or the guard refuses correct work —
    // which is how a guard gets deleted rather than fixed.
    expect(() => assertReadOnly('select updated_at, created_at from t')).not.toThrow()
  })

  it('refuses an identifier that is not a plain SQL name', () => {
    expect(() => sqlIdentifier("chores'; drop table chores; --")).toThrow(/plain SQL name/)
    expect(() => sqlIdentifier('Chores')).toThrow(/plain SQL name/)
    expect(sqlIdentifier('chore_exclusions')).toBe('chore_exclusions')
  })

  // The two tests below prove WIRING, not the functions — and until review they
  // were missing, so both guards could have been unhooked from the query builders
  // entirely and every other test in this file would have stayed green while the
  // module header's production-safety claim became false. `prove-tests` shape 12:
  // a test that builds its own call certifies the mechanism and says nothing
  // about whether the production path uses it. Deleting either call from
  // `relaclQuery`/`attaclQuery` now reddens here.

  it('WIRING: the query builders actually call sqlIdentifier', () => {
    // A hyphen is a legal-looking table name and an illegal SQL identifier, so it
    // can only be refused by the validator being in the path.
    expect(() => relaclQuery(['not-a-plain-name'])).toThrow(/plain SQL name/)
    expect(() => attaclQuery(['not-a-plain-name'])).toThrow(/plain SQL name/)
  })

  it('WIRING: the query builders actually call assertReadOnly', () => {
    // `drop` is a perfectly valid SQL identifier, so `sqlIdentifier` passes it —
    // and it puts the word into the generated SQL, where only `assertReadOnly`
    // being in the path can refuse it. That separation is what makes this a test
    // of the second guard rather than a second test of the first.
    expect(sqlIdentifier('drop')).toBe('drop')
    expect(() => relaclQuery(['drop'])).toThrow(/write verb/)
    expect(() => attaclQuery(['drop'])).toThrow(/write verb/)
  })

  it('quotes each name as a literal', () => {
    expect(nameList(['a', 'b_c'])).toBe("'a', 'b_c'")
  })
})

describe('what it asks for — AC 3', () => {
  const tables = [...LIVE_TABLES]

  it('reads pg_class.relacl for every table liveSchema.js names', () => {
    const sql = relaclQuery(tables)
    expect(sql).toContain('pg_class')
    expect(sql).toContain('relacl')
    for (const table of tables) expect(sql).toContain(`'${table}'`)
  })

  it('reads pg_attribute.attacl for every table liveSchema.js names', () => {
    const sql = attaclQuery(tables)
    expect(sql).toContain('pg_attribute')
    expect(sql).toContain('attacl')
    for (const table of tables) expect(sql).toContain(`'${table}'`)
  })

  it('the command works from liveSchema.js, not from a list restated in the script', () => {
    // The assertion is on `probeTables()` — what the COMMAND uses — rather than
    // on the `tables` constant this test built for itself. Passing an imported
    // list to the query builders proves the builders work and says nothing about
    // where the command gets its own, so a script that quietly kept a
    // hand-written list would pass every other test in this file.
    expect(probeTables()).toEqual([...LIVE_TABLES])
    expect(probeTables().length).toBeGreaterThan(0)
  })

  it('and that list is the one liveSchema.js actually names today', () => {
    // Named outright rather than derived, so adding a table has to be a
    // deliberate edit here — which is the assertion working, not friction.
    expect([...LIVE_TABLES]).toEqual([
      'households',
      'members',
      'chores',
      'member_capacity',
      'chore_exclusions',
      'calendar_connections',
    ])
  })

  it('asks for every column, not only the granted ones', () => {
    // An absent row and a row with an empty ACL are different answers. Filtering
    // to granted columns in SQL would make the negative control unrepresentable.
    const sql = attaclQuery(tables)
    expect(sql).toContain('attnum > 0')
    expect(sql).toContain('not a.attisdropped')
    expect(sql).not.toMatch(/attacl is not null/)
  })
})

/**
 * Which migrations grant `column` — one predicate, used by both the absence
 * assertion and its positive control.
 *
 * The corpus is DISCOVERED rather than listed. It was a hand-written list of
 * three files until review found it, and that list already omitted `0016` — so
 * the future-migration case the negative control exists for could not have
 * reddened it. A guard whose corpus is enumerated by hand covers exactly the
 * files somebody remembered, and the file that breaks it is by definition the
 * one written after the list.
 */
function migrationsGranting(column) {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .filter((file) =>
      new RegExp(`grant[^;]*\\b${column}\\b`, 'is').test(readFileSync(resolve(dir, file), 'utf8')),
    )
}

describe('the negative control — AC 3 requires one by name', () => {
  it('the expectation set contains a column that must have NO grant', () => {
    const controls = MEASURED_GRANTS.filter((entry) => entry.privileges === null)
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.map((entry) => `${entry.table}.${entry.column}`)).toContain(
      'chores.repeat_since',
    )
  })

  it('the control column is one NO migration grants, which is why it can be one', () => {
    // Asserted against the FILES rather than trusted: if any migration ever grants
    // `repeat_since`, the control silently stops being a control and this is what
    // says so. `0012` adds the column and withholds it deliberately.
    //
    // The corpus is DISCOVERED, and it was a hand-written list of three until
    // review found it — a list that already omitted `0016`, so the future-migration
    // case this test exists for could not have reddened it. A guard whose corpus is
    // enumerated by hand covers exactly the files somebody remembered, and the file
    // that breaks it is by definition the one written after the list.
    const dir = resolve(process.cwd(), 'supabase/migrations')
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql'))

    // Without this the whole test passes the moment the filter stops matching.
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('0012_repeating_chores.sql')

    expect(readFileSync(resolve(dir, '0012_repeating_chores.sql'), 'utf8')).toContain(
      'repeat_since',
    )

    const granted = migrationsGranting('repeat_since')
    expect(
      granted,
      `a migration now grants the negative control column: ${granted.join(', ')}`,
    ).toEqual([])
  })

  it('POSITIVE CONTROL: that scan DOES fire on a column the migrations really grant', () => {
    // The assertion above is an absence, and an absence proves nothing until the
    // search is shown to find something. This runs the SAME function against a
    // column `0014` really grants — one predicate, not two literals, because two
    // copies would let a typo break the real scan while the control went on
    // matching its own private pattern.
    expect(
      migrationsGranting('household_id').length,
      'the grant pattern matches nothing at all',
    ).toBeGreaterThan(0)
  })
})

describe('reading an aclitem', () => {
  it('extracts the privileges one role holds', () => {
    expect(privilegesFor('authenticated=r/postgres')).toBe('r')
    expect(privilegesFor('authenticated=ar/postgres')).toBe('ar')
  })

  it('finds the role among several entries', () => {
    expect(privilegesFor('postgres=arwdDxt/postgres,authenticated=r/postgres')).toBe('r')
  })

  it('copes with the braces Postgres prints an array in', () => {
    expect(privilegesFor('{authenticated=r/postgres,anon=r/postgres}')).toBe('r')
  })

  it('returns null when the role has no entry — which for a column means NO grant', () => {
    expect(privilegesFor('anon=r/postgres')).toBeNull()
    expect(privilegesFor('')).toBeNull()
    expect(privilegesFor(null)).toBeNull()
  })

  it('does not mistake a role whose name merely ENDS with the one asked for', () => {
    // `not_authenticated=r/postgres` must not answer for `authenticated`.
    expect(privilegesFor('not_authenticated=r/postgres')).toBeNull()
  })
})

describe('reconciling against what #150 measured — AC 4', () => {
  /** Catalog rows that agree with every expectation. */
  const agreeing = MEASURED_GRANTS.map((entry) => ({
    table_name: entry.table,
    column_name: entry.column,
    acl: entry.privileges === null ? '' : `${SUBJECT_ROLE}=${entry.privileges}/postgres`,
  }))

  it('agrees when the project matches, negative control included', () => {
    const verdicts = reconcile(agreeing)
    expect(verdicts).toHaveLength(MEASURED_GRANTS.length)
    expect(verdicts.every((verdict) => verdict.agrees)).toBe(true)
  })

  it('POSITIVE CONTROL: a wrong privilege string is reported, not absorbed', () => {
    // A comparator fed only correct data cannot be told apart from one that
    // always says yes.
    const rows = agreeing.map((row) =>
      row.table_name === 'households' && row.column_name === 'id'
        ? { ...row, acl: `${SUBJECT_ROLE}=rw/postgres` }
        : row,
    )
    const differing = reconcile(rows).filter((verdict) => !verdict.agrees)
    expect(differing).toHaveLength(1)
    expect(differing[0].key).toBe('households.id')
    expect(differing[0].actual).toBe('rw')
  })

  it('POSITIVE CONTROL: a grant appearing on the control column is reported', () => {
    // The control failing is the probe telling you it can no longer report an
    // absence. It must not pass quietly.
    const rows = agreeing.map((row) =>
      row.column_name === 'repeat_since'
        ? { ...row, acl: `${SUBJECT_ROLE}=r/postgres` }
        : row,
    )
    const differing = reconcile(rows).filter((verdict) => !verdict.agrees)
    expect(differing).toHaveLength(1)
    expect(differing[0].key).toBe('chores.repeat_since')
  })

  it('separates a MISSING column from a wrong grant, because they route differently', () => {
    // A column that is not there means a migration did not run. A column with the
    // wrong grant means one ran and did something else.
    const rows = agreeing.filter((row) => row.column_name !== 'household_id')
    const differing = reconcile(rows).filter((verdict) => !verdict.agrees)
    expect(differing).toHaveLength(2)
    expect(differing.every((verdict) => verdict.note === 'the column is not there')).toBe(true)
    expect(differing.map((verdict) => verdict.key).sort()).toEqual([
      'chores.household_id',
      'members.household_id',
    ])
  })

  it('every expectation names the migration it came from, so a stale row can be dated', () => {
    for (const entry of MEASURED_GRANTS) {
      expect(entry.source, `${entry.table}.${entry.column}`).toBeTruthy()
    }
  })

  it('the expectation set covers exactly what AC 4 names', () => {
    expect(MEASURED_GRANTS.map((entry) => `${entry.table}.${entry.column}=${entry.privileges}`)).toEqual([
      'households.id=r',
      'households.created_at=r',
      'households.organizer_member_id=r',
      'members.household_id=ar',
      'chores.household_id=ar',
      'chores.repeat_since=null',
    ])
  })
})
