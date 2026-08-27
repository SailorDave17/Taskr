// Re-derive the corpus figures — #40 AC 2.
//
// The criterion is that the proportion of scenarios reaching level is "recorded
// in the repo by a re-runnable command so the figure can be re-derived rather
// than trusted". This is that command. `npm run allocation:corpus` prints the
// table; docs/allocation-corpus.md holds the recorded numbers, and a test in
// src/lib/allocation.test.js fails when the document and this command disagree,
// so the record cannot quietly fall behind the corpus.
//
// It reports TWO proportions on purpose. Four of the shapes have fewer than two
// members with capacity — a household of one, an empty one, a week with no
// chores — and those are level because a set with fewer than two elements has
// no spread, not because the allocator achieved anything. Folding them into one
// headline figure would inflate it, and a single number that quietly includes
// vacuous passes is the shape of claim this repo keeps finding wrong.

import { allocate } from '../src/lib/allocation.js'
import { SCENARIOS } from '../src/lib/allocation.corpus.js'

const rows = SCENARIOS.map((scenario) => {
  const result = allocate({
    members: scenario.members,
    chores: scenario.chores,
    isEligible: scenario.isEligible,
  })
  return {
    name: scenario.name,
    workingMembers: scenario.workingMembers,
    level: result.level,
    spread: result.spread,
    contested: scenario.workingMembers >= 2,
  }
})

const total = rows.length
const level = rows.filter((r) => r.level).length
const contested = rows.filter((r) => r.contested)
const contestedLevel = contested.filter((r) => r.level).length

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`)

console.log('Allocation corpus — #40 AC 2')
console.log('='.repeat(78))
for (const row of rows) {
  const verdict = row.level ? 'level      ' : 'unreachable'
  const spread = row.contested ? `spread ${(row.spread * 100).toFixed(1).padStart(5)}pp` : 'no spread   '
  console.log(`  ${verdict}  ${spread}  ${row.name}`)
}
console.log('='.repeat(78))
console.log(`Scenarios:                       ${total}`)
console.log(`Reaching level:                  ${level} of ${total}  (${pct(level, total)})`)
console.log(`Of those where level is a real question (2+ members with capacity):`)
console.log(
  `Reaching level:                  ${contestedLevel} of ${contested.length}  (${pct(contestedLevel, contested.length)})`,
)

export const FIGURES = {
  total,
  level,
  contested: contested.length,
  contestedLevel,
}
