import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PropTypes from 'prop-types'
import InstallOffer, { useInstallOffer } from './InstallOffer.jsx'

// #483 — the line itself, and the hook that reads the controller.

afterEach(() => {
  cleanup()
})

/** A controller the test drives by hand: the shape `startInstallOffer` returns. */
function makeOffer(offered = true) {
  const listeners = new Set()
  const offer = {
    offered,
    subscribe: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    isOffered: () => offer.offered,
    install: vi.fn(),
    dismiss: vi.fn(),
    set(next) {
      offer.offered = next
      for (const listener of listeners) listener()
    },
  }
  return offer
}

function Probe({ offer }) {
  const offered = useInstallOffer(offer)
  return <output data-testid="offered">{String(offered)}</output>
}

Probe.propTypes = {
  offer: PropTypes.object,
}

describe('#483 — the line', () => {
  it('says the app can be installed, with Install and Not now, and nothing modal', () => {
    render(<InstallOffer onInstall={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText(/install taskr on this phone/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Install and Not now reach their handlers', () => {
    const onInstall = vi.fn()
    const onDismiss = vi.fn()
    render(<InstallOffer onInstall={onInstall} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('#483 — useInstallOffer', () => {
  it('reads the controller and follows its changes', () => {
    const offer = makeOffer(false)
    render(<Probe offer={offer} />)
    expect(screen.getByTestId('offered')).toHaveTextContent('false')
    act(() => offer.set(true))
    expect(screen.getByTestId('offered')).toHaveTextContent('true')
    act(() => offer.set(false))
    expect(screen.getByTestId('offered')).toHaveTextContent('false')
  })

  it('reads never-offered when there is no controller', () => {
    render(<Probe offer={null} />)
    expect(screen.getByTestId('offered')).toHaveTextContent('false')
  })
})

// ---------------------------------------------------------------------------
// #484 — the iOS variant of the same line: instructions, not a button.
// ---------------------------------------------------------------------------

describe('#484 — the iOS line', () => {
  it('names the two taps, in order, and offers only Not now', () => {
    render(<InstallOffer variant="ios" onDismiss={() => {}} />)
    const strip = screen.getByTestId('install-offer')
    // The sentence, read as a person reads it — across the <strong> elements,
    // which is why this asserts the strip's text rather than a single node.
    expect(strip).toHaveTextContent(/add taskr to your home screen: tap share, then add to home screen/i)
    // There is nothing for an Install button to do on iOS: no page can open
    // Safari's Share sheet, so a button here could only fail to.
    expect(screen.queryByRole('button', { name: /^install$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks the two controls a person has to FIND, and not the whole sentence', () => {
    render(<InstallOffer variant="ios" onDismiss={() => {}} />)
    const strip = screen.getByTestId('install-offer')
    const marked = [...strip.querySelectorAll('strong')].map((node) => node.textContent)
    expect(marked).toEqual(['Share', 'Add to Home Screen'])
  })

  it('Not now reaches its handler', () => {
    const onDismiss = vi.fn()
    render(<InstallOffer variant="ios" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('the prompt variant is unchanged, and is the default', () => {
    // The control for the variant switch: #483's line must not have moved.
    // Rendered with no `variant` at all, which is how a caller that predates
    // #484 would call it.
    render(<InstallOffer onInstall={() => {}} onDismiss={() => {}} />)
    const strip = screen.getByTestId('install-offer')
    expect(strip).toHaveTextContent(/install taskr on this phone/i)
    expect(strip).not.toHaveTextContent(/home screen/i)
    expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument()
    expect(strip.querySelectorAll('strong')).toHaveLength(0)
  })

  // jsdom applies no stylesheet and computes no layout, so this reads the CSS
  // as TEXT. That is a weaker assertion than the measurement — it proves the
  // rule is still there, not that the result is still right — and it is here
  // because the measurement lives in a comment and an issue while the number
  // it turns on lives in a file anybody can edit.
  it('#484: the sentence keeps a basis wide enough to claim the row', () => {
    // MEASURED on the real App and the real stylesheet at 360px (2026-09-21,
    // recorded on #484): at the old `8rem` the instruction was squeezed into
    // 207px of 320, wrapped to three lines, and broke "Add to Home Screen" —
    // one of the two controls the person has to find — across a line, while
    // Not now kept 89px beside it. At 18rem the sentence takes the row (308px,
    // two lines, both control names intact) and the button drops beneath.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const rule = css.match(/\.shell__install-text\s*\{([^}]*)\}/)
    expect(rule, 'the install sentence still has a rule').not.toBeNull()
    const basis = rule[1].match(/flex:\s*\d+\s+\d+\s+([\d.]+)rem/)
    expect(basis, 'the rule still sets a flex basis in rem').not.toBeNull()
    // Wider than a 360px row minus the 89px button, which is what forces the
    // wrap rather than the squeeze. 18rem = 288px.
    expect(Number(basis[1])).toBeGreaterThanOrEqual(16)
  })

  it('says which variant it is in the DOM, so a test above the component can tell them apart', () => {
    const { unmount } = render(<InstallOffer variant="ios" onDismiss={() => {}} />)
    expect(screen.getByTestId('install-offer')).toHaveAttribute('data-variant', 'ios')
    unmount()
    render(<InstallOffer onInstall={() => {}} onDismiss={() => {}} />)
    expect(screen.getByTestId('install-offer')).toHaveAttribute('data-variant', 'prompt')
  })
})
