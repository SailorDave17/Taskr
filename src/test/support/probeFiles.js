// The one reserved filename every run-time directory walker in this repo skips,
// and the reason it has to exist — #192.
//
// WHAT THIS IS FOR
//
// `retiredVocabulary.test.js` proves the retired-vocabulary corpus reaches files
// ON DISK by writing a probe into each covered directory, reading it back
// through the same scan, and removing it in a `finally`. That probe has to be
// admitted by the corpus predicate for its directory, which pins its extension:
// `.js`/`.jsx` under `src/`, `.ts`/`.js` under `supabase/functions`, and a
// `NNNN_*.sql` name above 0007 under `supabase/migrations`.
//
// Those are exactly the extensions the other files below enumerate at RUN TIME,
// in parallel vitest workers. So the probe cannot dodge them by name or by
// extension, and #170 shipped an in-memory plant instead — correctly, on the
// evidence it had. This module is the other route: one marker, skipped by NAME
// before any `statSync` or `readFileSync`, so the probe is invisible to every
// walker rather than merely unlikely to be seen by one.
//
// The counts are not written here twice. `gate.test.js`'s `#192` block derives
// them from the tree and asserts them, which is the same argument #170 AC 6
// made about the vocabulary list: a computable number in prose is the most
// recurring defect this repo has.
//
// THE CENSUS THIS RESTS ON — measured 2026-09-09, `grep -rn readdirSync src scripts`
//
// Under `src/` recursively, so `src/lib` and `src/components` both:
//   src/lib/allocation.test.js       readdirSync -> statSync   (throws on a vanished entry)
//   src/lib/capacity.test.js         readdirSync -> statSync   (throws)
//   src/lib/capture.test.js          readdirSync -> statSync   (throws)
//   src/lib/liveSchema.test.js       readdirSync -> statSync   (throws; also collects `.rpc(` names)
//   src/lib/calendar.test.js         withFileTypes -> readFileSync
//   src/test/gate.test.js            withFileTypes -> readFileSync   (the #87 secret scan)
// `src/components` alone:
//   src/components/Chores.test.jsx   readdirSync -> readFileSync
//   src/test/gate.test.js            readdirSync -> readFileSync   (the stylesheet guard)
// `supabase/migrations`:
//   src/test/support/pgliteSupabase.js      migrationFilesOnDisk(), whose result two
//                                           pglite suites assert is a subset of MIGRATIONS —
//                                           so a probe there is a RED, not merely a race
//   src/test/scoping-mechanism.pglite.test.js
//   scripts/management-api.test.js
//   scripts/probe-live-grants.test.js       (twice)
// Repo-wide corpora that would list a probe while it exists:
//   src/test/gate.test.js            the #19 name corpus (`git ls-files --others`), which
//                                    reads every listed path — so it needs the skip too
//   src/test/gate.test.js            the scheduler scan and the token scan already
//                                    `try`/`catch` their reads, and need nothing
// Structurally immune, and the reason #170's untracked control could put a real
// probe in that one directory:
//   src/test/edge-function-cors.test.js     filters the directory to `isDirectory()`
//
// WHAT THIS COSTS, STATED RATHER THAN HIDDEN
//
// Every walker above now ignores a filename. That is a hole: a real source file
// carrying the marker would escape all of them at once. Two things close it, and
// both are in `gate.test.js` — no TRACKED path may carry the marker, so the hole
// cannot be occupied by a committed file; and every file that enumerates a
// directory at run time must reference this module, so a walker added tomorrow
// cannot reintroduce the race by being written the obvious way. That second
// guard is deliberately WIDER than the hazard: a walker over `docs/` is caught
// too. A false positive costs one import; a false negative costs an
// intermittent red that five green runs cannot tell from a fix.
//
// The marker is deliberately a substring rather than an exact name. The four
// probes cannot share one spelling: a migration's name must begin with four
// digits, so it cannot be dot-prefixed like the other three.

/** The substring every probe filename carries, and nothing else in the tree may. */
export const PROBE_MARKER = 'retired-probe'

/**
 * Is this entry a probe some test is planting right now?
 *
 * Takes a bare directory entry name or a full path — the marker only ever
 * appears in the basename, so either answers the same question. Callers must ask
 * this BEFORE touching the filesystem: the walkers that `statSync` an entry
 * before filtering it are the ones a vanishing file throws in.
 */
export function isProbeFile(name) {
  return String(name).includes(PROBE_MARKER)
}
