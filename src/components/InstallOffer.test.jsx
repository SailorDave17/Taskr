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
