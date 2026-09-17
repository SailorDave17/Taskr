/**
 * Whether this sign-in should outlive the browser — #482.
 *
 * THE OWNER'S ASK (2026-09-16): "add a trust this device checkbox, otherwise
 * it wont resign you in". Until #482 every sign-in was permanent: the client
 * kept the session in `localStorage` and rotated the refresh token forever, so
 * a person who signed in on somebody else's computer left their household open
 * to whoever sat down next.
 *
 * THE MECHANISM IS WHERE THE SESSION IS KEPT, NOT WHETHER IT IS. The obvious
 * setting, `persistSession: false`, holds the session in memory and drops it on
 * every reload — and "don't keep me signed in" does not mean "sign me out when
 * the page reloads" to anybody. So the client is given `sessionTrustStorage`
 * below, which keeps the session in `sessionStorage` for an untrusted sign-in
 * (it survives a reload and dies with the browser) and in `localStorage`
 * otherwise (today's behaviour, unchanged).
 *
 * THE FLAG LIVES IN `sessionStorage` TOO, and that is what makes it safe. It is
 * written BEFORE the sign-in call, because the session is saved inside that
 * call and the adapter has to know where to put it by then. And it dies at
 * exactly the moment the session it routes dies: a closed browser takes both,
 * so the next boot finds no flag, reads `localStorage`, finds nothing, and
 * shows the sign-in form. A flag kept in `localStorage` would outlive the
 * session it described and route the NEXT person's sign-in.
 *
 * IT SURVIVES THE GOOGLE ROUND TRIP because Supabase returns the person to the
 * same tab, and `sessionStorage` belongs to the tab. Taskr's client uses the
 * IMPLICIT flow (`household.js`'s `signInWithGoogle` records why), so the
 * session arrives in the URL fragment and is saved at the next boot — through
 * this adapter, which by then reads the flag written before the page left.
 * There is no PKCE verifier to carry; the issue's text assumed one.
 *
 * WHAT IT DOES NOT MOVE. The chosen household (`activeHousehold.js`) and a held
 * invitation (`pendingInvitation.js`) stay in `localStorage` whatever the flag
 * says. They are about the device, not the session, and the invitation has to
 * reach a NEW tab opened from a mail app, which `sessionStorage` cannot do.
 *
 * WHAT IT COSTS. `sessionStorage` is per tab, so an untrusted session is not
 * shared with a second tab: a new tab opens on the sign-in form. That is the
 * narrower promise, and the one the checkbox's own sentence makes.
 */

/**
 * The flag's key. `'1'` means the sign-in in this tab is NOT trusted; absence
 * means it is, so a tab that never saw the checkbox behaves as it always did.
 */
export const UNTRUSTED_KEY = 'taskr.untrustedSession'

/** A named storage, or null when the browser refuses to hand it over. */
function store(name) {
  try {
    return globalThis[name] ?? null
  } catch {
    return null
  }
}

/** Whether this tab's sign-in was made without trusting the device. */
export function isUntrustedSession() {
  try {
    return store('sessionStorage')?.getItem(UNTRUSTED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Record the person's choice, BEFORE the sign-in call that saves the session.
 *
 * Trusting is the default and needs nothing stored, so it only clears. Not
 * trusting has to be written, and a browser that refuses `sessionStorage` would
 * otherwise put the session in `localStorage` without saying so — the one
 * outcome the person just asked not to happen. So that case THROWS, and the
 * screen shows the sentence instead of signing them in.
 *
 * @param {boolean} trusted
 */
export function setSessionTrust(trusted) {
  const session = store('sessionStorage')
  if (trusted) {
    try {
      session?.removeItem(UNTRUSTED_KEY)
    } catch {
      // Nothing to clear if the store cannot be reached, and nothing to route.
    }
    return
  }
  try {
    session.setItem(UNTRUSTED_KEY, '1')
    if (session.getItem(UNTRUSTED_KEY) !== '1') throw new Error('not kept')
  } catch (cause) {
    const err = new Error(
      'This browser will not keep a sign-in to this window only. Tick “Trust this device”, ' +
        'or use a browser that allows site storage.',
    )
    err.cause = cause
    throw err
  }
}

/** The store this tab's session belongs in, decided afresh on every access. */
function sessionStore() {
  return isUntrustedSession() ? store('sessionStorage') : store('localStorage')
}

/**
 * The auth client's `storage` — supabase-js reads and writes the session
 * through exactly these three calls. Each one asks the flag which store to use
 * at the moment of the call, not when the client was built, because the client
 * is built once and the choice is made at each sign-in.
 *
 * One store per call, never both: removing from `localStorage` on an untrusted
 * sign-out would end a trusted session another tab of this browser is holding.
 */
export const sessionTrustStorage = {
  getItem(key) {
    return sessionStore()?.getItem(key) ?? null
  },
  setItem(key, value) {
    sessionStore()?.setItem(key, value)
  },
  removeItem(key) {
    sessionStore()?.removeItem(key)
  },
}
