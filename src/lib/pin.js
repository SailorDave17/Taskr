// The shape rule for a member PIN, in one place.
//
// It is stated three times in the running system — here, in the UI's disabled
// state, and in `assert_valid_pin` in migration 0002 — and only the last one is
// a guard. This module exists so the first two are the same statement rather
// than two that drift, which is a failure this workspace has shipped before: a
// rule written out twice, inverted, in race-timer #89.
//
// The server's copy cannot import this one, so that pair is kept honest by a
// test rather than by structure. See pin.test.js.

export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 12

/**
 * Why 4: a nine-year-old has to be able to remember it and type it on a phone
 * they are holding in one hand. Why not shorter: a three-digit PIN is 1000
 * possibilities and there is deliberately no rate limit on the claim path, so
 * the length is doing all of the work.
 *
 * Why a maximum at all: it is a PIN, not a password, and a length cap keeps the
 * bcrypt input bounded without a separate rule.
 */
export function isValidPin(pin) {
  const value = String(pin ?? '').trim()
  return value.length >= PIN_MIN_LENGTH && value.length <= PIN_MAX_LENGTH
}

/**
 * Throw with a message a parent can act on. This is a courtesy so the user is
 * not made to wait for a round trip — it is NOT the guard. The guard is
 * `assert_valid_pin` in the database, which is reached whatever the client does.
 */
export function assertPinShape(pin) {
  const value = String(pin ?? '').trim()
  if (!isValidPin(value)) {
    throw new Error(`A PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} characters.`)
  }
  return value
}
