import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  KNOWN_FLAGS,
  MIGRATIONS_DIR,
  applyMigration,
  assertKnownFlags,
  dryRunRequested,
  migrationFileFrom,
  planLines,
} from './migrate-live.mjs'
import { localBytes, localChars, localDigest } from './management-api.mjs'

// `npm run migrate:live` — #185 AC 1 and AC 2.
//
// The impure half — reading `process.argv`, exiting — is deliberately untested,
// exactly as `deploy-function.test.js` leaves the CLI spawn alone. What IS tested
// is every decision the command makes before it changes anything: which file it
// will accept, what it prints, and the ORDER of its two round trips.
//
// That order is the whole design, so it is asserted directly rather than
// inferred: the echo must happen first and the apply must NOT happen when the
// echo disagrees. A test that only checked the error message would pass just as
// happily against a version that applied the migration and complained afterwards.

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0013_grants_the_platform_no_longer_infers.sql'),
  'utf8',
)

/** A fetch that answers the echo with `describe`, and records every call. */
function fakeApi({ describe: description, applyOk = true }) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const sql = JSON.parse(init.body).query
    calls.push(sql)
    const isEcho = sql.startsWith('with payload as')
    if (isEcho) {
      return { ok: true, status: 200, text: async () => JSON.stringify([description]) }
    }
    if (!applyOk) {
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'syntax error at or near "grnat"' }),
      }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([]) }
  }
  return { calls, fetchImpl }
}

const honest = {
  chars: localChars(SQL),
  bytes: localBytes(SQL),
  digest: localDigest(SQL),
}

describe('which file this command will accept', () => {
  it('takes a migration by path', () => {
    const path = migrationFileFrom([`${MIGRATIONS_DIR}/0013_grants_the_platform_no_longer_infers.sql`])
    expect(path).toMatch(/0013_grants_the_platform_no_longer_infers\.sql$/)
  })

  it('ignores flags when looking for the file', () => {
    expect(() =>
      migrationFileFrom(['--dry-run', `${MIGRATIONS_DIR}/0013_grants_the_platform_no_longer_infers.sql`]),
    ).not.toThrow()
  })

  it('refuses no argument, and says what to type', () => {
    expect(() => migrationFileFrom([])).toThrow(/Name the migration to apply/)
    expect(() => migrationFileFrom([])).toThrow(/takes a FILE, never SQL/)
  })

  it('refuses two files, because migrations have an order', () => {
    expect(() =>
      migrationFileFrom([`${MIGRATIONS_DIR}/a.sql`, `${MIGRATIONS_DIR}/b.sql`]),
    ).toThrow(/One file at a time/)
  })

  it('refuses a path outside supabase/migrations/', () => {
    // The narrowing #185 argued for: this must not become the general "run SQL
    // against production" command.
    expect(() => migrationFileFrom(['scripts/migrate-live.mjs'])).toThrow(/Not a migration/)
    expect(() => migrationFileFrom(['/etc/passwd'])).toThrow(/Not a migration/)
  })

  it('refuses a traversal that ends up outside, even when it starts inside', () => {
    // The comparison is on the RESOLVED path for exactly this. A check against
    // the string would let this through, and the value of the restriction is
    // that it cannot be talked around.
    expect(() => migrationFileFrom([`${MIGRATIONS_DIR}/../../package.json`])).toThrow(
      /Not a migration/,
    )
  })

  it('refuses a subdirectory, so the directory means the directory', () => {
    expect(() => migrationFileFrom([`${MIGRATIONS_DIR}/nested/0001.sql`])).toThrow(/Not a migration/)
  })

  it('refuses a non-.sql file inside the directory', () => {
    expect(() => migrationFileFrom([`${MIGRATIONS_DIR}/README.md`])).toThrow(/Not a \.sql file/)
  })
})

describe('the rehearsal flag, and the two ways it used to be lost', () => {
  it('is recognised when it reaches argv', () => {
    expect(dryRunRequested(['file.sql', '--dry-run'], {})).toBe(true)
    expect(dryRunRequested(['file.sql'], {})).toBe(false)
  })

  it('is ALSO recognised when npm ate it, which is the natural spelling', () => {
    // `npm run migrate:live <file> --dry-run` forwards only the file and sets
    // `npm_config_dry_run="true"`, because npm has a `--dry-run` of its own and
    // claims it first. Reading argv alone meant the flag was absent and the
    // command performed a real, irreversible apply while the operator believed
    // they had asked for a rehearsal. Measured under npm 11.16.0.
    expect(dryRunRequested(['file.sql'], { npm_config_dry_run: 'true' })).toBe(true)
    expect(dryRunRequested(['file.sql'], { npm_config_dry_run: '1' })).toBe(true)
  })

  it('does not read an unrelated or falsy npm value as a rehearsal', () => {
    expect(dryRunRequested(['file.sql'], { npm_config_dry_run: 'false' })).toBe(false)
    expect(dryRunRequested(['file.sql'], { npm_config_dry_run: '' })).toBe(false)
    expect(dryRunRequested(['file.sql'], { npm_config_something_else: 'true' })).toBe(false)
  })

  it('REFUSES an unknown flag rather than dropping it', () => {
    // The mistyped flag is the dangerous one: the person who typed it is by
    // definition the person expecting nothing to happen. `migrationFileFrom`
    // filters `-`-prefixed arguments out when looking for the file, which is
    // right for finding a file and silently wrong for everything else.
    expect(() => assertKnownFlags(['file.sql', '--dry-rnu'])).toThrow(/Unknown flag/)
    expect(() => assertKnownFlags(['file.sql', '--dryrun'])).toThrow(/Unknown flag/)
    expect(() => assertKnownFlags(['file.sql', '--pretend'])).toThrow(/Unknown flag/)
    expect(() => assertKnownFlags(['file.sql', '-n'])).toThrow(/Unknown flag/)
  })

  it('names both working spellings in the refusal, since npm is why there are two', () => {
    expect(() => assertKnownFlags(['--dry-rnu'])).toThrow(/-- --dry-run/)
  })

  it('accepts the flag it knows, and a bare file', () => {
    expect(() => assertKnownFlags(['file.sql', '--dry-run'])).not.toThrow()
    expect(() => assertKnownFlags(['file.sql'])).not.toThrow()
  })

  it('KNOWN_FLAGS is the single list both the refusal and the detector work from', () => {
    // A second copy would let the two disagree — a flag accepted by one and
    // unrecognised by the other is a flag that is silently dropped again.
    expect(KNOWN_FLAGS).toContain('--dry-run')
    for (const flag of KNOWN_FLAGS) {
      expect(() => assertKnownFlags([flag]), flag).not.toThrow()
    }
  })
})

describe('what it prints before it sends anything', () => {
  const lines = planLines({ ref: 'abcdefghijklmnopqrst', path: 'supabase/migrations/0013.sql', sql: SQL })
  const text = lines.join('\n')

  it('names the project it derived, so a wrong target is visible before the send', () => {
    expect(text).toContain('abcdefghijklmnopqrst')
    expect(text).toContain('derived from VITE_SUPABASE_URL')
  })

  it('prints the statement count — AC 1', () => {
    expect(text).toMatch(/statements : 3\b/)
  })

  it('prints the character count and the digest — AC 1', () => {
    expect(text).toContain(`characters : ${localChars(SQL)}`)
    expect(text).toContain(localDigest(SQL))
  })
})

describe('the two round trips, and the order they must happen in', () => {
  it('echoes FIRST, then applies', async () => {
    const { calls, fetchImpl } = fakeApi({ describe: honest })
    const result = await applyMigration({ ref: 'r', token: 't', sql: SQL, fetchImpl })

    expect(result).toMatchObject({ ok: true, applied: true })
    expect(calls).toHaveLength(2)
    expect(calls[0].startsWith('with payload as')).toBe(true)
    expect(calls[1]).toBe(SQL)
  })

  it('REFUSES TO APPLY when the database describes a different payload', async () => {
    // The assertion that matters is the call count, not the message. A version
    // that applied the migration and complained afterwards would produce an
    // identical error and do the opposite of what this command is for.
    const truncated = SQL.slice(0, 4000)
    const { calls, fetchImpl } = fakeApi({
      describe: {
        chars: localChars(truncated),
        bytes: localBytes(truncated),
        digest: localDigest(truncated),
      },
    })

    const result = await applyMigration({ ref: 'r', token: 't', sql: SQL, fetchImpl })

    expect(result.applied).toBe(false)
    expect(result.stage).toBe('echo')
    expect(calls).toHaveLength(1)
    expect(calls[0].startsWith('with payload as')).toBe(true)
  })

  it('refuses on a digest mismatch even when the character count agrees', async () => {
    // A character-set round trip swaps characters without losing any, so the
    // count is intact and the bytes are not. This is the case the browser route
    // needed a person to check by hand.
    const swapped = SQL.replace('—', '-')
    const { calls, fetchImpl } = fakeApi({
      describe: { chars: localChars(SQL), bytes: localBytes(SQL), digest: localDigest(swapped) },
    })

    const result = await applyMigration({ ref: 'r', token: 't', sql: SQL, fetchImpl })

    expect(result.applied).toBe(false)
    expect(result.problems.join(' ')).toMatch(/md5 differs/)
    expect(calls).toHaveLength(1)
  })

  it('treats an echo that returns no row as a refusal, not as agreement', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify([]) })
    const result = await applyMigration({ ref: 'r', token: 't', sql: SQL, fetchImpl })
    expect(result.applied).toBe(false)
    expect(result.problems).toEqual(['the database returned no description of what it received'])
  })

  it('reports a failed echo request as unproven, and applies nothing', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push(JSON.parse(init.body).query)
      return { ok: false, status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) }
    }
    const result = await applyMigration({ ref: 'r', token: 't', sql: SQL, fetchImpl })
    expect(result).toMatchObject({ ok: false, stage: 'echo', applied: false })
    expect(result.error).toMatch(/401/)
    expect(calls).toHaveLength(1)
  })

  it('separates a bad payload from bad SQL, because they route to different repairs', async () => {
    // The payload arrived intact and Postgres refused it. Saying so is the
    // difference between somebody looking at the wire and somebody looking at
    // the file.
    const { calls, fetchImpl } = fakeApi({ describe: honest, applyOk: false })
    const result = await applyMigration({ ref: 'r', token: 't', sql: SQL, fetchImpl })

    expect(result).toMatchObject({ ok: false, stage: 'apply', applied: false })
    expect(result.error).toMatch(/syntax error/)
    expect(calls).toHaveLength(2)
  })
})
