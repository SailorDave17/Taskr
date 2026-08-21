// The names `0007_per_member_auth.sql` retired, and the scanner that proves a
// suite has stopped naming them — #88 AC 2.
//
// WHY THIS IS A MODULE AND NOT AN ARRAY INSIDE THE TEST
//
// The assertion reads a test file's SOURCE and refuses any of these names in it.
// A guard whose subject is source text cannot tell the hazard from a declaration
// of the hazard, so the file that *lists* what is forbidden would refuse itself
// — cairn records this as `a-guard-that-reads-source-must-survive-its-own-docs`,
// and `src/test/gate.test.js` hit it for real when its `service_role` scan
// flagged `keyShape.js`.
//
// gate.test.js answers with an allowlist. This answers by MOVING THE
// DECLARATION OUT of the scanned set, which is strictly better where it is
// available: an allowlist is a list that can go stale and quietly widen, and
// this has nothing to keep current. The scanned files are named by the caller
// and this file is never one of them.
//
// WHY COMMENTS ARE STRIPPED
//
// Match the scan to its subject. The subject here is an executable REFERENCE —
// a call to `join_household`, a column named `pin_hash` — because that is what
// fails against a project on 0007. Prose *about* the retired model is not only
// harmless, it is the thing a migrated file most needs to carry: the header of
// `rls.integration.test.js` explains what went and why, and it must be free to
// name them. Scanning comments would make the correct file unwritable.

/** Everything 0007 dropped, by the name a caller would still spell. */
export const RETIRED_BY_0007 = Object.freeze([
  // Auth model: a device signed in with no identity of its own.
  'signInAnonymously',
  // Admission: a shared code admitted a device to a household.
  'join_household',
  'generate_join_code',
  'join_code',
  // Identity: a device later proved which person it was acting as.
  'claim_member',
  'claim_member_with_pin',
  // Credential: the PIN the database minted and checked.
  'set_member_pin',
  'assert_valid_pin',
  'has_pin',
  'pin_hash',
  // Membership: the table every policy used to ask about.
  'household_devices',
])

// Ordered longest-first so a match reports the most specific name it can.
// `claim_member` is a prefix of `claim_member_with_pin`, and `join_code` is a
// substring of `generate_join_code`; without this the report names the shorter
// one and sends a reader looking in the wrong place.
const BY_SPECIFICITY = Object.freeze(
  [...RETIRED_BY_0007].sort((a, b) => b.length - a.length),
)

/**
 * Blank out every comment in JavaScript source, preserving line structure.
 *
 * Replaced with spaces rather than removed so that line and column numbers in a
 * report still point at the real source. Not a parser: it tracks the three
 * states that matter — inside a string, inside a line comment, inside a block
 * comment — which is enough for the question being asked and is exercised by
 * `retiredVocabulary.test.js` against synthetic input, because the real corpus
 * may not contain the awkward cases at all.
 */
export function blankComments(source) {
  const out = []
  let i = 0
  let quote = null

  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]

    if (quote) {
      out.push(char)
      if (char === '\\') {
        // An escaped character cannot close the string, and cannot open a
        // comment either. Carry it and its escapee across untouched.
        out.push(next ?? '')
        i += 2
        continue
      }
      if (char === quote) quote = null
      i += 1
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out.push(char)
      i += 1
      continue
    }

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out.push(' ')
        i += 1
      }
      continue
    }

    if (char === '/' && next === '*') {
      out.push(' ', ' ')
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        // Newlines are kept so the line count does not shift.
        out.push(source[i] === '\n' ? '\n' : ' ')
        i += 1
      }
      out.push(' ', ' ')
      i += 2
      continue
    }

    out.push(char)
    i += 1
  }

  return out.join('')
}

/**
 * Every retired name still referenced in executable code, with its line.
 *
 * An empty array is the passing answer. Each finding carries the line so the
 * failure message can name a place rather than a fact — a scan that says only
 * "something is wrong" costs the reader the same search twice.
 */
export function retiredNamesIn(source) {
  const code = blankComments(source)
  const lines = code.split('\n')
  const found = []

  lines.forEach((line, index) => {
    let remaining = line
    for (const name of BY_SPECIFICITY) {
      if (!remaining.includes(name)) continue
      found.push({ name, line: index + 1 })
      // Blank this name out before testing the shorter ones, so
      // `claim_member_with_pin` is not also reported as `claim_member`.
      remaining = remaining.split(name).join(' '.repeat(name.length))
    }
  })

  return found
}
