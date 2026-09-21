/**
 * #451 — the published pages the app links out to.
 *
 * `reportProblem.js` next door is documented as "a `mailto:` and nothing else
 * … This module talks to no server", and a published `https` page is a
 * different kind of thing, so it lives here rather than widening that file's
 * stated contract. One constant, one place — the same rule `REPORT_ADDRESS`
 * follows.
 */

/**
 * Taskr's privacy policy, published by madcowsailing.com #66. It is the only
 * one Taskr has, and the page says so in its own foot.
 *
 * The extensionless address is deliberate: `…/privacy.html` answers too, by
 * redirecting here, and linking the destination saves a round trip on a page
 * somebody opens from a phone. Owner's call on #451.
 */
export const PRIVACY_URL = 'https://madcowhq.com/apps/taskr/privacy'
