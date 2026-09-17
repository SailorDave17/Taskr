import { Component } from 'react'
import PropTypes from 'prop-types'

/**
 * What the app draws when something under it throws while rendering — #478.
 *
 * React 18 unmounts the whole tree on an uncaught render error. Until this
 * story nothing in Taskr caught one, so a single throw left the page with no
 * title, no switcher and no tabs until a reload. *Measured on the owner's
 * account, 2026-09-17*: a household switch paired one household's roster with
 * another's chores for one render, `allocate()` refused it, and that is
 * exactly what the owner saw. `refresh()` now lands its reads together so
 * that pairing cannot happen; this is the floor under every other throw
 * nobody has found yet, so the next one shows a sentence and a way out
 * rather than nothing.
 *
 * Two placements, and the difference is what stays on screen:
 *
 *   - around the SURFACES, keyed on the household and the tab, so the title,
 *     the switcher and the tab strip stay drawn and usable. Choosing another
 *     household or another tab changes the key, which remounts this and
 *     clears the failure — the person's next move is itself the retry;
 *   - around the whole shell, as the last resort, where there is nothing
 *     left to keep and a reload is the only way back.
 *
 * A class component because an error boundary still can only be one. What a
 * person reads is a fixed sentence; the thrown message goes in a collapsed
 * disclosure for a problem report, because a render throw is by nature an
 * invariant written for a developer (see the comment in `render`).
 */
export default class RenderFailure extends Component {
  constructor(props) {
    super(props)
    this.state = { message: null }
  }

  static getDerivedStateFromError(error) {
    return { message: error?.message || String(error) }
  }

  // #478 — tells the owner of this boundary that its children are gone, so
  // anything those children used to show (the surfaces' own `error` line)
  // can be shown somewhere that is still drawn.
  componentDidCatch(error) {
    this.props.onCatch?.(error)
  }

  // And that this boundary is gone — its key changed, so a fresh one (with
  // its children back) has replaced it. Unmount runs before the replacement's
  // own catch in the same commit, which is why this is a lifecycle rather
  // than an effect in the owner keyed on the same value: an effect would run
  // after the catch and clear it.
  componentWillUnmount() {
    this.props.onRelease?.()
  }

  render() {
    const { message } = this.state
    if (message === null) return this.props.children
    const { heading = 'Something went wrong showing this', shell = false } = this.props
    // THE PERSON READS A SENTENCE, THE REPORT CARRIES THE THROW (design-bar
    // verdict, owner, 2026-09-17). The first draft put the thrown message in
    // the alert, and at 360×800 the owner's own crash read "Chore 7875e977-…
    // is assigned to unknown member 992be3b7-…" — an invariant written for a
    // developer, with two ids, in the one place a household member looks.
    // The raw text is kept, collapsed, so a screenshot sent with Report a
    // problem still says what threw. `.stack` spaces the parts: without it
    // Reload sat flush against the alert.
    const card = (
      <section
        className="card stack"
        aria-labelledby="render-failure-heading"
        data-testid="render-failure"
      >
        <h2 id="render-failure-heading" className="card__heading">
          {heading}
        </h2>
        <p className="error" role="alert">
          Taskr hit a problem showing this. Choosing another tab or household, or reloading,
          usually clears it.
        </p>
        <details className="render-failure__details">
          <summary className="render-failure__summary">Details for a problem report</summary>
          <p className="render-failure__detail" data-testid="render-failure-detail">
            {message}
          </p>
        </details>
        <div className="row">
          <button className="button" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </section>
    )
    // At the root there is no shell left to sit in, so the fallback brings
    // the page's own frame and title rather than a card on a bare body.
    if (!shell) return card
    return (
      <main className="shell">
        <h1 className="shell__title">Taskr</h1>
        {card}
      </main>
    )
  }
}

RenderFailure.propTypes = {
  children: PropTypes.node,
  heading: PropTypes.string,
  shell: PropTypes.bool,
  onCatch: PropTypes.func,
  onRelease: PropTypes.func,
}
