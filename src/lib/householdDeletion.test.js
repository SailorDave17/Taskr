import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRACE_PERIOD_DAYS } from './household.js'

// #430 — the number the delete confirm says, held equal to the one the
// database enforces. Migration 0042's `household_grace_period()` is the
// authority; a change to either side without the other fails here, not in a
// person's inbox a week later.

const MIGRATION = `${process.cwd()}/supabase/migrations/0042_delete_a_household_with_a_grace_period.sql`

function gracePeriodInMigration() {
  const sql = readFileSync(MIGRATION, 'utf8').replace(/--[^\n]*/g, '')
  const body = sql.match(/function public\.household_grace_period\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)
  expect(body, 'household_grace_period() not found in 0042').not.toBeNull()
  const days = body[1].match(/interval\s+'(\d+)\s+days?'/)
  expect(days, 'household_grace_period() is not written in days').not.toBeNull()
  return Number(days[1])
}

describe('the grace period is one number (#430)', () => {
  it('the client says what the database enforces', () => {
    expect(GRACE_PERIOD_DAYS).toBe(gracePeriodInMigration())
  })

  it('and it is the owner’s seven days', () => {
    expect(GRACE_PERIOD_DAYS).toBe(7)
  })
})
