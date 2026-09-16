import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  INVITATION_LIFETIME_DAYS,
  invitationDateLabel,
  invitationShareText,
  outstandingInvitations,
} from '../lib/invitations.js'

/**
 * The organizer's invitation card — story #172.
 *
 * Rendered by Roster ONLY for the organizer of the household on screen, and that
 * gate lives in Roster rather than here on purpose: `isOrganizer` is a property
 * of the ACTIVE household (AC 6), and the component that already holds the
 * active household's organizer answer is the one that decides whether this
 * exists at all. Nothing in here re-asks the question, so there is exactly one
 * gate to remove and one test that reddens when it goes (AC 7).
 *
 * THIS IS NOT THE GUARD. `invitations_select_organizer`, `_insert_organizer` and
 * `_update_organizer` are, and they refuse a non-organizer's read and writes
 * with no client involved — `invitationMint.pglite.test.js` proves the read
 * through the exact statement the app issues. Offering a control the database
 * would always refuse is the thing #87 decided against on the sign-in control,
 * and hiding this card from a member is that decision again.
 */
export default function Invitations({
  invitations,
  mintedCode,
  timeZone,
  busy,
  onMint,
  onWithdraw,
  onDismissCode,
}) {
  const outstanding = outstandingInvitations(invitations)

  // Share — owner decision at the design-bar pass, 2026-09-10. Offered only
  // where the browser HAS a share sheet (Android Chrome, the install target,
  // does); elsewhere the code itself, selectable as a unit, is the route, so a
  // missing sheet costs a control and never the ability to pass the code on.
  //
  // The failure is keyed to the code it failed FOR, so a fresh code never
  // arrives wearing the last one's complaint — and no effect is needed to
  // clear it. A cancel (`AbortError`) is somebody backing out of the sheet,
  // which is not a failure and says nothing.
  const canShare = typeof globalThis.navigator?.share === 'function'
  const [shareFailedFor, setShareFailedFor] = useState(null)
  const shareCode = async () => {
    setShareFailedFor(null)
    try {
      await globalThis.navigator.share({ text: invitationShareText(mintedCode) })
    } catch (err) {
      if (err?.name !== 'AbortError') setShareFailedFor(mintedCode)
    }
  }

  return (
    <section className="card" aria-labelledby="invite-heading" data-testid="invitations-card">
      <h2 id="invite-heading" className="card__heading">
        Invite someone
      </h2>
      <div className="stack">
        {/* Inside the stack, for the reason the "Start another household" card
            gives: `.card__note` carries `margin-bottom: 0`, so a note between a
            heading and the content butts against it at 0px. The stack's own gap
            is what spaces every other note in this file. */}
        <p className="card__note">
          A code lets one person into this household, whether or not they already
          use Taskr. Read it out or send it. It works once, for{' '}
          {INVITATION_LIFETIME_DAYS} days, and you can withdraw it until it is used.
        </p>

        {/* AC 2 — shown ONCE, and "once" is the database's word rather than the
            screen's. `0040` stores a digest and never the code, so there is no
            read anywhere that could put it back after this; the only copy is
            the one in App's state, handed down here, and it goes when the
            organizer hides it, switches household or signs out.

            `role="status"` so the arrival of the code is announced — the button
            that produced it has just been pressed and focus has not moved. */}
        {mintedCode ? (
          <div className="invitation-minted" role="status" data-testid="minted-code">
            <p className="card__note">Here is the code. Taskr keeps no copy it can show you again.</p>
            {/* Selectable as a unit (`user-select: all`), because the other way
                to pass it on is a message and a code you cannot copy invites a
                typo. Lower case on purpose — the string shown IS the string
                hashed, and the letters that read alike are not in it. */}
            <p className="invitation-minted__code" data-testid="minted-code-value">
              {mintedCode}
            </p>
            <p className="card__note">
              If it goes astray, withdraw it below, hide this, and create another.
            </p>
            {shareFailedFor !== null && shareFailedFor === mintedCode ? (
              <p className="card__note" role="status" data-testid="share-failed">
                The share sheet did not open. Press and hold the code to copy it into
                a message instead.
              </p>
            ) : null}
            <div className="row row--end">
              {canShare ? (
                <button className="button" type="button" onClick={shareCode}>
                  Share the code
                </button>
              ) : null}
              <button className="button button--quiet" type="button" onClick={onDismissCode}>
                Hide the code
              </button>
            </div>
          </div>
        ) : null}

        {/* HIDDEN while a code is on screen — owner decision at the design-bar
            re-measure, 2026-09-10. Every number was clean and the screenshot
            was not: the heaviest control in view after a mint was this one,
            full-width and filled, directly under a code that is the only copy
            that will ever exist. One stray tap replaced it. Minting another now
            starts with "Hide the code", which is a deliberate act, and Share is
            the one filled control while the code is up. */}
        {mintedCode ? null : (
          <button
            className="button"
            type="button"
            onClick={onMint}
            disabled={busy}
            data-testid="mint-invitation"
          >
            Create an invitation code
          </button>
        )}

        {/* AC 3 — only what is still usable. Withdrawn and redeemed rows never
            arrive (the read filters both stamps server-side), and an expired one
            is dropped here by the same `<=` the server refuses on, so nothing
            listed is a code `redeem_invitation` would turn down. */}
        {outstanding.length > 0 ? (
          <>
            <h3 className="card__subheading">Waiting to be used</h3>
            <ul className="invitation-list" data-testid="invitation-list">
              {outstanding.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  timeZone={timeZone}
                  busy={busy}
                  onWithdraw={onWithdraw}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  )
}

Invitations.propTypes = {
  invitations: PropTypes.array.isRequired,
  mintedCode: PropTypes.string,
  timeZone: PropTypes.string,
  busy: PropTypes.bool,
  onMint: PropTypes.func.isRequired,
  onWithdraw: PropTypes.func.isRequired,
  onDismissCode: PropTypes.func.isRequired,
}

/**
 * One outstanding invitation, with when it was made, when it lapses, and the
 * way to withdraw it — AC 3 and AC 4.
 *
 * CONFIRM IN PLACE, the Remove idiom (MemberRow) and #291's sign-out-everywhere.
 * A withdrawal cannot be undone — `0040` has no un-withdraw and the code is
 * stored nowhere to be re-issued — and two adjacent controls on a phone are a
 * mis-tap waiting to happen. The first tap arms it; the second names what it
 * is about to do.
 *
 * The Withdraw button's accessible name carries the creation time, so two
 * outstanding codes produce two DIFFERENT controls to a screen reader rather
 * than two identical "Withdraw" buttons — which is also what lets a test pick
 * one without reaching into the DOM.
 */
function InvitationRow({ invitation, timeZone, busy, onWithdraw }) {
  const [confirming, setConfirming] = useState(false)
  const created = invitationDateLabel(invitation.created_at, timeZone)
  const expires = invitationDateLabel(invitation.expires_at, timeZone)

  return (
    <li className="invitation" data-testid={`invitation-${invitation.id}`}>
      <span className="invitation__dates">
        Created {created ?? 'recently'}
        {expires ? ` · stops working ${expires}` : null}
      </span>
      <div className="row row--end">
        {confirming ? (
          <>
            <button
              className="button button--danger"
              type="button"
              onClick={() => onWithdraw(invitation.id)}
              disabled={busy}
            >
              Withdraw this code?
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-label={`Withdraw the code created ${created ?? 'recently'}`}
          >
            Withdraw
          </button>
        )}
      </div>
    </li>
  )
}

InvitationRow.propTypes = {
  invitation: PropTypes.object.isRequired,
  timeZone: PropTypes.string,
  busy: PropTypes.bool,
  onWithdraw: PropTypes.func.isRequired,
}
