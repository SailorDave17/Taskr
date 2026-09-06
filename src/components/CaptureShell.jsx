import { useEffect, useId, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { CAPTURE_OUTCOMES } from '../lib/capture.js'

// The shared capture shell — story #210 AC 8.
//
// Four behaviours, implemented ONCE, that every plain-language flow needs: the
// description field, the pending state while the endpoint is asked, the swap to
// the manual path when it cannot answer, and a layout that survives a 360px
// phone. The capacity flow (Roster.jsx) uses it today; the chore flow (#213)
// reuses it, and that story asserts there is one implementation in the tree.
// Two copies would be two places for the fallback to rot independently, and
// the fallback is the one thing the charter says must never break.
//
// WHAT THE SHELL KNOWS, AND WHAT IT DELIBERATELY DOES NOT
//
// It knows the OUTCOME vocabulary (`CAPTURE_OUTCOMES`) and nothing about what
// a proposal contains. `onDescribe(text)` is the flow's — it returns an outcome
// — and `renderProposal(outcome)` is the flow's too, because a capacity
// proposal is one figure and a chore proposal is a list. The manual path is
// the CHILDREN: the flow renders its own typed fields inside the shell, and the
// shell only decides when to draw attention to them.
//
// NOT A FORM. The shell renders a `<div>`, and its Propose control is
// `type="button"`, so it can sit INSIDE the flow's own form — which is what
// keeps one submit, one write path (AC 9): the proposal is a prefill of the
// same fields the same Save writes, never a second button that writes.
//
// THE MANUAL FIELDS ARE ALWAYS RENDERED. AC 2 says the manual field is offered
// "in the same flow" when extraction fails; the stronger property, and the one
// that makes #46's tests pass with this file deleted (AC 7), is that it is
// offered ALWAYS. A failure does not reveal the manual path — it moves the
// description box out of the way and puts focus on the field that was there
// throughout. A member who never types a description sees the typed field
// exactly where #46 put it.
//
// A QUESTION KEEPS THE BOX. The refusal outcome (AC 4) is the endpoint asking
// for more, so the description stays editable with the question under it; only
// the three failure outcomes swap to manual, because there is nothing a better
// sentence would fix about a dropped connection.

const SWAPS_TO_MANUAL = new Set([
  CAPTURE_OUTCOMES.FAILED,
  CAPTURE_OUTCOMES.TIMEOUT,
  CAPTURE_OUTCOMES.UNUSABLE,
])

export default function CaptureShell({
  label,
  placeholder,
  describeLabel = 'Work it out from that',
  pendingLabel = 'Working it out…',
  retryLabel = 'Describe it again',
  manualHint = 'Type it in instead.',
  busy,
  onDescribe,
  renderProposal,
  children,
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState(null)
  const manualRef = useRef(null)
  const mounted = useRef(true)
  const fieldId = useId()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const swapped = Boolean(result && SWAPS_TO_MANUAL.has(result.outcome))

  // Focus follows the swap: the member was looking at the description box, and
  // the field they are being handed is beneath it. Focus rather than scroll —
  // a focused input is scrolled into view by the browser, and it is also the
  // thing a screen reader announces.
  useEffect(() => {
    if (!swapped) return
    manualRef.current?.querySelector('input, textarea, select')?.focus()
  }, [swapped])

  async function describe() {
    const description = text.trim()
    if (!description) return
    setPending(true)
    setResult(null)
    let outcome
    try {
      outcome = await onDescribe(description)
    } catch (error) {
      outcome = { outcome: CAPTURE_OUTCOMES.FAILED, sentence: String(error?.message ?? error) }
    }
    // The row may have closed while the endpoint was thinking (AC 3's
    // navigate-away). Nothing to show, and nothing was written.
    if (!mounted.current) return
    setPending(false)
    setResult(outcome)
  }

  function retry() {
    setResult(null)
  }

  const disabled = Boolean(busy) || pending

  return (
    <div className="capture" data-testid="capture-shell">
      {swapped ? null : (
        <>
          <label className="field" htmlFor={fieldId}>
            <span className="field__label">{label}</span>
            <textarea
              id={fieldId}
              className="field__input capture__text"
              rows={3}
              value={text}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="button button--quiet"
              type="button"
              disabled={disabled || !text.trim()}
              onClick={describe}
            >
              {describeLabel}
            </button>
            {pending ? (
              <span className="capture__outcome" role="status" data-testid="capture-pending">
                {pendingLabel}
              </span>
            ) : null}
          </div>
        </>
      )}

      {result && result.outcome === CAPTURE_OUTCOMES.PROPOSAL ? (
        <div className="capture__proposal" data-testid="capture-proposal">
          {renderProposal(result)}
        </div>
      ) : null}

      {result && result.outcome === CAPTURE_OUTCOMES.QUESTION ? (
        <p className="capture__outcome" role="status" data-testid="capture-question">
          {result.sentence}
        </p>
      ) : null}

      {swapped ? (
        <div className="capture__failure" data-testid="capture-failure">
          <p className="capture__outcome" role="status">
            {result.sentence} {manualHint}
          </p>
          <button className="button button--link" type="button" disabled={disabled} onClick={retry}>
            {retryLabel}
          </button>
        </div>
      ) : null}

      <div className="capture__manual" ref={manualRef}>
        {children}
      </div>
    </div>
  )
}

CaptureShell.propTypes = {
  label: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  describeLabel: PropTypes.string,
  pendingLabel: PropTypes.string,
  retryLabel: PropTypes.string,
  manualHint: PropTypes.string,
  busy: PropTypes.bool,
  onDescribe: PropTypes.func.isRequired,
  renderProposal: PropTypes.func.isRequired,
  children: PropTypes.node,
}
