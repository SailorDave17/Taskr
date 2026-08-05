// Join-code handling on the client.
//
// Deliberately narrow. The code *alphabet* lives in exactly one place — the
// `join_code` check constraint in supabase/migrations/0001_household_and_roster.sql
// — and this file does not restate it. A parent who types "O" instead of "0"
// gets "no household matches that code" from the server, which is true, rather
// than a client-side message derived from a second copy of the rule that can
// drift away from the first. This project has already shipped that defect class
// elsewhere and it is not worth re-earning for one round trip.
//
// What is duplicated, unavoidably, is the code LENGTH: the client needs it to
// know when there is enough input to bother asking. joinCode.test.js reads the
// migration and asserts the two agree, so drift fails the suite rather than
// failing a family at the kitchen table.

/** Number of characters in a join code. Mirrored from the migration's `{8}`. */
export const JOIN_CODE_LENGTH = 8

/**
 * Make a typed code comparable: upper-case, and drop anything a person might
 * add for legibility — spaces, hyphens, the dot at the end of a sentence.
 *
 * The server normalises identically in `join_household`, because the client is
 * not the only possible caller.
 */
export function normalizeJoinCode(input) {
  if (typeof input !== 'string') return ''
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Is this worth sending? Length only — whether the characters are in the
 * alphabet is the server's question, and it is the only holder of that answer.
 */
export function isPlausibleJoinCode(input) {
  return normalizeJoinCode(input).length === JOIN_CODE_LENGTH
}
