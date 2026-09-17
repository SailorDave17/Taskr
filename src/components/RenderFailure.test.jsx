import { fireEvent, render, screen, within } from '@testing-library/react'
import PropTypes from 'prop-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RenderFailure from './RenderFailure.jsx'

// #478 — the floor under a render throw. What App does with it (where the
// two boundaries sit and what stays on screen) is App.test.jsx; this is the
// component on its own.

function Boom({ message }) {
  throw new Error(message)
}
Boom.propTypes = { message: PropTypes.string.isRequired }

describe('the render-failure boundary', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  afterEach(() => quiet.mockClear())

  it('draws its children untouched when nothing throws', () => {
    render(
      <RenderFailure heading="Placeholder heading">
        <p>Placeholder child</p>
      </RenderFailure>,
    )
    expect(screen.getByText('Placeholder child')).toBeInTheDocument()
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
  })

  it('replaces a throwing child with the heading, a sentence for a person as the alert, and a Reload', () => {
    render(
      <RenderFailure heading="Placeholder heading">
        <Boom message="Placeholder invariant 1234-abcd." />
      </RenderFailure>,
    )
    const card = screen.getByTestId('render-failure')
    expect(card).toHaveTextContent('Placeholder heading')
    // design-bar verdict: the alert is the app's sentence, never the throw.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/taskr hit a problem showing this/i)
    expect(alert).toHaveTextContent(/another tab or household, or reloading/i)
    expect(alert).not.toHaveTextContent('Placeholder invariant')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // Not inside a page frame unless asked: the surface placement sits in one.
    expect(card.closest('main')).toBeNull()
  })

  it('keeps the thrown message for a problem report, collapsed', () => {
    render(
      <RenderFailure>
        <Boom message="Placeholder invariant 1234-abcd." />
      </RenderFailure>,
    )
    const detail = screen.getByTestId('render-failure-detail')
    expect(detail).toHaveTextContent('Placeholder invariant 1234-abcd.')
    const disclosure = detail.closest('details')
    expect(disclosure).not.toBeNull()
    expect(disclosure.open).toBe(false)
    expect(within(disclosure).getByText('Details for a problem report').tagName).toBe('SUMMARY')
  })

  it('Reload reloads the page', () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
    try {
      render(
        <RenderFailure>
          <Boom message="Placeholder sentence." />
        </RenderFailure>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('with `shell`, brings the page frame and the title with it', () => {
    render(
      <RenderFailure shell heading="Placeholder heading">
        <Boom message="Placeholder sentence." />
      </RenderFailure>,
    )
    const card = screen.getByTestId('render-failure')
    expect(card.closest('main.shell')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Taskr' })).toBeInTheDocument()
  })

  it('reports a catch to its owner, once, with the error', () => {
    const onCatch = vi.fn()
    render(
      <RenderFailure onCatch={onCatch}>
        <Boom message="Placeholder sentence." />
      </RenderFailure>,
    )
    expect(onCatch).toHaveBeenCalledTimes(1)
    expect(onCatch.mock.calls[0][0].message).toBe('Placeholder sentence.')
  })

  it('does not report a catch when nothing threw, and reports its release when it goes', () => {
    const onCatch = vi.fn()
    const onRelease = vi.fn()
    const { unmount } = render(
      <RenderFailure onCatch={onCatch} onRelease={onRelease}>
        <p>Placeholder child</p>
      </RenderFailure>,
    )
    expect(onCatch).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
    unmount()
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('has a sensible heading when none is given', () => {
    render(
      <RenderFailure>
        <Boom message="Placeholder sentence." />
      </RenderFailure>,
    )
    expect(screen.getByTestId('render-failure')).toHaveTextContent(/something went wrong/i)
  })
})
