/**
 * #425 — the footer's "Report a problem" link.
 *
 * Somebody testing Taskr reports from the screen where it happened, and the
 * report says which build and which screen without their having to work that
 * out. It is a `mailto:` and nothing else: the person's own mail app opens with
 * the message filled in, they see and can edit every word of it, and nothing
 * leaves until they send it. This module talks to no server.
 *
 * The tracker is public (docs/access-model.md, #328), so a report must not land
 * there as an issue. And because a person may forward the email, what goes in
 * it is an ALLOWLIST of four fields rather than app state with some fields
 * taken out. A household name, a member's name, an address, a row id or a chore
 * title cannot reach the message because nothing here reads one: a caller that
 * passes one has it ignored. A blocklist would have to know every field the app
 * will ever hold; the allowlist only has to know these four.
 */

/** The contact address madcowhq.com publishes. One constant, one place. */
export const REPORT_ADDRESS = 'hsc.coach@gmail.com'

/** Every field a report carries, in the order the body lists them. */
export const REPORT_FIELDS = [
  ['build', 'Build'],
  ['environment', 'Environment'],
  ['screen', 'Screen'],
  ['browser', 'Browser'],
]

/**
 * What the Screen line says outside a household. Inside one it is the tab's own
 * label, so a report reads the way the person saw the app.
 *
 * `onboarding` is ONE status for two screens — signed out (sign in) and signed
 * in with no household yet (start or join) — so its label names neither.
 */
export const SCREEN_FOR_STATUS = {
  loading: 'Loading screen',
  onboarding: 'Onboarding screen',
  unconfigured: 'No-backend screen',
  failed: 'Connection-failed screen',
}

const UNKNOWN = 'unknown'

/** The Screen line's value, from the shell's `status` and `view`. */
export function reportScreen({ status, view, surfaces = [] } = {}) {
  if (status === 'joined') {
    return surfaces.find((surface) => surface.key === view)?.label ?? view ?? UNKNOWN
  }
  return SCREEN_FOR_STATUS[status] ?? status ?? UNKNOWN
}

function valueOf(input, key) {
  const value = input?.[key]
  return value == null || value === '' ? UNKNOWN : String(value)
}

/** One `Label: value` line per allowlisted field, and only those. */
export function reportDetails(input = {}) {
  return REPORT_FIELDS.map(([key, label]) => `${label}: ${valueOf(input, key)}`)
}

export function reportSubject(input = {}) {
  return `Taskr problem report (build ${valueOf(input, 'build')})`
}

/**
 * CRLF between lines, which is what RFC 6068 asks of a `mailto:` body; a bare
 * LF is accepted by most mail apps and not all of them.
 */
export function reportBody(input = {}) {
  return [
    'What happened, and what did you expect to happen?',
    '',
    '',
    '---',
    ...reportDetails(input),
  ].join('\r\n')
}

/**
 * The link itself. Subject and body are each passed through
 * `encodeURIComponent`, so a value holding `&`, `#` or `?` — a user agent can —
 * stays inside its own parameter instead of ending the message early.
 */
export function reportHref(input = {}) {
  const subject = encodeURIComponent(reportSubject(input))
  const body = encodeURIComponent(reportBody(input))
  return `mailto:${REPORT_ADDRESS}?subject=${subject}&body=${body}`
}
