import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Invitations from './Invitations.jsx'
import {
  INVITATION_LIFETIME_DAYS,
  invitationDateLabel,
  invitationShareText,
} from '../lib/invitations.js'

// The organizer's invitation card — story #172, ACs 2, 3, 4 and 7.
//
// The ROLE gate (who sees this card at all) is Roster's and is asserted in
// Roster.test.jsx; this file owns the gates INSIDE the card: whether a code is
// on screen, whether the list is, and the two-tap withdrawal. Each control's
// presence and its absence are separate tests, so removing a gate reddens the
// absence test and removing the control reddens the presence one (AC 7).
//
// Button names are matched by REGEX throughout — gate.test.js's #19 POSITION
// scan reads a `name: '…'` string literal in a test as a person's name.
//
// Names are synthetic — see #19.

const ZONE = 'America/New_York'
// Far enough out that the real clock `outstandingInvitations` reads cannot
// overtake it during a run, and in the past for the expired case.
const LATER = '2099-09-17T19:04:00.000Z'
const EARLIER = '2020-01-01T00:00:00.000Z'

const row = (id, { created = '2026-09-10T19:04:00.000Z', expires = LATER } = {}) => ({
  id,
  household_id: 'h1',
  created_by_member_id: 'm1',
  created_at: created,
  expires_at: expires,
  withdrawn_at: null,
  redeemed_at: null,
  redeemed_by_member_id: null,
})

function setup(props = {}) {
  const handlers = {
    onMint: vi.fn(),
    onWithdraw: vi.fn(),
    onDismissCode: vi.fn(),
  }
  render(
    <Invitations invitations={[]} mintedCode={null} timeZone={ZONE} busy={false} {...handlers} {...props} />,
  )
  return handlers
}

describe('#172 AC 1 — the control that creates an invitation', () => {
  it('is offered, and pressing it asks for one', () => {
    const { onMint } = setup()
    const button = screen.getByRole('button', { name: /create an invitation code/i })
    fireEvent.click(button)
    expect(onMint).toHaveBeenCalledTimes(1)
  })

  it('says what a code does before anybody makes one', () => {
    setup()
    const card = screen.getByTestId('invitations-card')
    // The terms of the thing, at the moment it is being decided: one person,
    // whether or not they have an account, once, for a bounded time, and
    // withdrawable. `INVITATION_LIFETIME_DAYS` is read from the data layer so
    // the sentence cannot drift from the expiry the mint actually writes.
    expect(card).toHaveTextContent(/one person/i)
    expect(card).toHaveTextContent(new RegExp(`for\\s+${INVITATION_LIFETIME_DAYS} days`))
    expect(card).toHaveTextContent(/withdraw it until it is used/i)
  })

  it('is disabled while a write is in flight', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: /create an invitation code/i })).toBeDisabled()
  })
})

describe('#172 AC 2 — the code, shown once', () => {
  it('shows the code when one has just been minted', () => {
    setup({ mintedCode: 'k7m3qp4rwn' })
    expect(screen.getByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
    // Announced on arrival — the button that produced it has just been pressed
    // and focus has not moved to it.
    expect(screen.getByTestId('minted-code')).toHaveAttribute('role', 'status')
  })

  it('shows NO code when none has been minted — the gate on `mintedCode`', () => {
    setup({ mintedCode: null })
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
    expect(screen.queryByTestId('minted-code-value')).not.toBeInTheDocument()
  })

  it('says plainly that it will not be shown again', () => {
    // "Displayed once" is the database's fact, not the screen's, and the
    // organizer has to know it before they look away.
    setup({ mintedCode: 'k7m3qp4rwn' })
    expect(screen.getByTestId('minted-code')).toHaveTextContent(/keeps no copy it can show you again/i)
    expect(screen.getByTestId('minted-code')).toHaveTextContent(
      /withdraw it below, hide this, and create another/i,
    )
  })

  it('offers no Create control while a code is on screen — a stray tap cannot replace the only copy', () => {
    // Owner decision at the design-bar re-measure: the full-width Create sat
    // directly under the code, and pressing it swapped the one copy that will
    // ever exist for a new one. The presence half is AC 1's first test above,
    // with no code shown.
    setup({ mintedCode: 'k7m3qp4rwn' })
    expect(screen.queryByRole('button', { name: /create an invitation code/i })).not.toBeInTheDocument()
    // Positive control: the card rendered, so the absence is the gate's.
    expect(screen.getByRole('button', { name: /hide the code/i })).toBeInTheDocument()
  })

  it('shows the code exactly as it was hashed — no case change, no separator', () => {
    // The string on screen has to BE the string the digest was taken of. A
    // display that upper-cased it or broke it with hyphens would read as a
    // different code from the one `redeem_invitation` will accept.
    setup({ mintedCode: 'k7m3qp4rwn' })
    expect(screen.getByTestId('minted-code-value').textContent).toBe('k7m3qp4rwn')
  })

  it('can be hidden once it has been passed on', () => {
    const { onDismissCode } = setup({ mintedCode: 'k7m3qp4rwn' })
    fireEvent.click(screen.getByRole('button', { name: /hide the code/i }))
    expect(onDismissCode).toHaveBeenCalledTimes(1)
  })

  it('offers no hide control when there is nothing to hide', () => {
    setup({ mintedCode: null })
    expect(screen.queryByRole('button', { name: /hide the code/i })).not.toBeInTheDocument()
  })
})

describe('#172 AC 3 — the outstanding invitations', () => {
  it('lists each one with when it was created and when it stops working', () => {
    setup({ invitations: [row('i1')] })
    const item = screen.getByTestId('invitation-i1')
    // Built with the real label function rather than hand-typed, so the test
    // follows the formatter's own tests instead of restating them.
    expect(item).toHaveTextContent(`Created ${invitationDateLabel('2026-09-10T19:04:00.000Z', ZONE)}`)
    expect(item).toHaveTextContent(`stops working ${invitationDateLabel(LATER, ZONE)}`)
  })

  it('shows NO list when nothing is outstanding — the gate on the list', () => {
    setup({ invitations: [] })
    expect(screen.queryByTestId('invitation-list')).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting to be used/i)).not.toBeInTheDocument()
  })

  it('drops one that has expired, so nothing listed is a code the server refuses', () => {
    setup({ invitations: [row('i1'), row('i2', { expires: EARLIER })] })
    expect(screen.getByTestId('invitation-i1')).toBeInTheDocument()
    expect(screen.queryByTestId('invitation-i2')).not.toBeInTheDocument()
  })

  it('shows NO list when every one has expired', () => {
    // The gate is on what is OUTSTANDING, not on what arrived: rows that are
    // all dead must not leave an empty "Waiting to be used" heading behind.
    setup({ invitations: [row('i1', { expires: EARLIER })] })
    expect(screen.queryByTestId('invitation-list')).not.toBeInTheDocument()
  })

  it('gives two invitations minted the same day two different controls', () => {
    setup({
      invitations: [
        row('i1', { created: '2026-09-10T19:04:00.000Z' }),
        row('i2', { created: '2026-09-10T19:11:00.000Z' }),
      ],
    })
    const names = screen
      .getAllByRole('button', { name: /withdraw the code created/i })
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })
})

describe('#172 AC 4 — withdrawing one', () => {
  it('offers a withdraw control on each outstanding invitation', () => {
    setup({ invitations: [row('i1')] })
    expect(
      within(screen.getByTestId('invitation-i1')).getByRole('button', { name: /withdraw the code created/i }),
    ).toBeInTheDocument()
  })

  it('takes two taps — the first arms it and withdraws nothing', () => {
    const { onWithdraw } = setup({ invitations: [row('i1')] })
    const item = screen.getByTestId('invitation-i1')
    fireEvent.click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    expect(onWithdraw).not.toHaveBeenCalled()
    expect(within(item).getByRole('button', { name: /withdraw this code\?/i })).toBeInTheDocument()
  })

  it('withdraws THAT invitation on the second tap', () => {
    const { onWithdraw } = setup({ invitations: [row('i1'), row('i2')] })
    const item = screen.getByTestId('invitation-i2')
    fireEvent.click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    fireEvent.click(within(item).getByRole('button', { name: /withdraw this code\?/i }))
    expect(onWithdraw).toHaveBeenCalledTimes(1)
    expect(onWithdraw).toHaveBeenCalledWith('i2')
  })

  it('can be backed out of, and backing out withdraws nothing', () => {
    const { onWithdraw } = setup({ invitations: [row('i1')] })
    const item = screen.getByTestId('invitation-i1')
    fireEvent.click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    act(() => {
      fireEvent.click(within(item).getByRole('button', { name: /keep it/i }))
    })
    expect(onWithdraw).not.toHaveBeenCalled()
    expect(within(item).queryByRole('button', { name: /withdraw this code\?/i })).not.toBeInTheDocument()
    expect(within(item).getByRole('button', { name: /withdraw the code created/i })).toBeInTheDocument()
  })

  it('shows no confirm control until it is armed', () => {
    setup({ invitations: [row('i1')] })
    expect(screen.queryByRole('button', { name: /withdraw this code\?/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep it/i })).not.toBeInTheDocument()
  })

  it('is disabled while a write is in flight', () => {
    setup({ invitations: [row('i1')], busy: true })
    expect(screen.getByRole('button', { name: /withdraw the code created/i })).toBeDisabled()
  })
})

// Owner decision at the design-bar pass, 2026-09-10: `navigator.share` exists on
// the Android install target and is the phone-native way to SEND a code, where
// select-and-copy is a long-press and a menu. jsdom has no share sheet, so each
// test installs one on `navigator` and the afterEach takes it away again — the
// default in this file is a browser WITHOUT one, which is the fallback case.
describe('#172 — sharing the code', () => {
  const installShare = (impl) =>
    Object.defineProperty(globalThis.navigator, 'share', { value: impl, configurable: true, writable: true })

  afterEach(() => {
    Reflect.deleteProperty(globalThis.navigator, 'share')
  })

  it('offers Share beside the code where the browser has a share sheet', () => {
    installShare(vi.fn().mockResolvedValue(undefined))
    setup({ mintedCode: 'k7m3qp4rwn' })
    expect(
      within(screen.getByTestId('minted-code')).getByRole('button', { name: /share the code/i }),
    ).toBeInTheDocument()
  })

  it('offers no Share button where the browser has no share sheet', () => {
    // The fallback is the code itself, selectable as a unit — so a missing
    // share sheet costs a control, never the ability to pass the code on.
    setup({ mintedCode: 'k7m3qp4rwn' })
    expect(screen.queryByRole('button', { name: /share the code/i })).not.toBeInTheDocument()
    // Positive control: the block rendered, so the absence is the gate's.
    expect(screen.getByRole('button', { name: /hide the code/i })).toBeInTheDocument()
  })

  it('offers no Share button when there is no code to share', () => {
    installShare(vi.fn().mockResolvedValue(undefined))
    setup({ mintedCode: null })
    expect(screen.queryByRole('button', { name: /share the code/i })).not.toBeInTheDocument()
  })

  it('sharing sends the code in a message that names no household', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    installShare(share)
    setup({ mintedCode: 'k7m3qp4rwn' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /share the code/i }))
    })
    expect(share).toHaveBeenCalledTimes(1)
    // Exactly one key: no `title` carrying a household name, no `url`.
    expect(share).toHaveBeenCalledWith({ text: invitationShareText('k7m3qp4rwn') })
  })

  it('a cancelled share says nothing — backing out of the sheet is not a failure', async () => {
    installShare(vi.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError')))
    setup({ mintedCode: 'k7m3qp4rwn' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /share the code/i }))
    })
    expect(screen.queryByTestId('share-failed')).not.toBeInTheDocument()
  })

  it('a failed share says how to pass the code on instead', async () => {
    installShare(vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError')))
    setup({ mintedCode: 'k7m3qp4rwn' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /share the code/i }))
    })
    // "Press and hold", not "tap": on a phone a tap does not select text, and
    // the fallback has to be an instruction that works on the install target.
    expect(screen.getByTestId('share-failed')).toHaveTextContent(/press and hold the code/i)
  })
})
