import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CaptureShell from './CaptureShell.jsx'
import { CAPTURE_OUTCOMES } from '../lib/capture.js'

// The shared capture shell — #210 AC 8. What is tested here is the shell's
// four behaviours in isolation from any flow: the description field, the
// pending state, the failure-to-manual swap, and that it is not a form of its
// own. What a proposal LOOKS like belongs to the flow and is tested in
// Roster.test.jsx.
//
// Names are synthetic — see #19.

function setup(overrides = {}) {
  const onDescribe = vi.fn()
  render(
    <form onSubmit={(e) => e.preventDefault()} data-testid="the-flow-form">
      <CaptureShell
        label="Describe it"
        onDescribe={onDescribe}
        renderProposal={(result) => (
          <span data-testid="rendered-proposal">proposed {result.minutes}</span>
        )}
        {...overrides}
      >
        <label>
          Typed minutes
          <input aria-label="Typed minutes" />
        </label>
      </CaptureShell>
    </form>,
  )
  return { onDescribe }
}

const box = () => screen.queryByLabelText('Describe it')
const proposeButton = () => screen.getByRole('button', { name: /work it out/i })

async function describeIt(text) {
  fireEvent.change(box(), { target: { value: text } })
  await act(async () => void fireEvent.click(proposeButton()))
}

describe('the description field', () => {
  it('hands the trimmed description to the flow', async () => {
    const { onDescribe } = setup()
    onDescribe.mockResolvedValue({ outcome: CAPTURE_OUTCOMES.PROPOSAL, minutes: 30 })
    await describeIt('  Sam only has half an hour this week.  ')
    expect(onDescribe).toHaveBeenCalledWith('Sam only has half an hour this week.')
  })

  it('will not ask with nothing typed', () => {
    setup()
    expect(proposeButton()).toBeDisabled()
    fireEvent.change(box(), { target: { value: '   ' } })
    expect(proposeButton()).toBeDisabled()
  })

  it('is not a form of its own, so it can live inside the flow’s form with one submit', () => {
    setup()
    // ONE form in the document — the flow's. A nested form is invalid HTML and
    // the browser silently drops it; a second submit would be a second write
    // path, which AC 9 forbids.
    expect(document.querySelectorAll('form')).toHaveLength(1)
    expect(proposeButton()).toHaveAttribute('type', 'button')
  })

  it('renders the manual field before anything is described — the floor is always there', () => {
    setup()
    expect(screen.getByLabelText('Typed minutes')).toBeInTheDocument()
  })

  it('a busy flow disables the ask', () => {
    setup({ busy: true })
    fireEvent.change(box(), { target: { value: 'anything' } })
    expect(proposeButton()).toBeDisabled()
  })
})

describe('the pending state', () => {
  it('says it is working and disables the controls until the flow answers', async () => {
    const { onDescribe } = setup()
    let resolve
    onDescribe.mockReturnValue(new Promise((r) => (resolve = r)))
    fireEvent.change(box(), { target: { value: 'three hours' } })
    await act(async () => void fireEvent.click(proposeButton()))

    expect(screen.getByTestId('capture-pending')).toHaveTextContent(/working it out/i)
    expect(box()).toBeDisabled()
    expect(proposeButton()).toBeDisabled()

    await act(async () => resolve({ outcome: CAPTURE_OUTCOMES.PROPOSAL, minutes: 180 }))
    expect(screen.queryByTestId('capture-pending')).not.toBeInTheDocument()
    expect(box()).toBeEnabled()
  })
})

describe('what comes back', () => {
  it('renders a proposal through the flow’s own renderer', async () => {
    const { onDescribe } = setup()
    onDescribe.mockResolvedValue({ outcome: CAPTURE_OUTCOMES.PROPOSAL, minutes: 180 })
    await describeIt('three hours')
    expect(screen.getByTestId('rendered-proposal')).toHaveTextContent('proposed 180')
    expect(box(), 'the description stays, so it can be refined').toBeInTheDocument()
  })

  it('a question keeps the description box and shows the sentence under it (AC 4)', async () => {
    const { onDescribe } = setup()
    onDescribe.mockResolvedValue({
      outcome: CAPTURE_OUTCOMES.QUESTION,
      sentence: 'One more detail is needed. The message names no amount of time.',
    })
    await describeIt('busy this week')
    expect(screen.getByTestId('capture-question')).toHaveTextContent(/one more detail/i)
    expect(box()).toBeInTheDocument()
    expect(box()).toHaveValue('busy this week')
    expect(screen.queryByTestId('capture-failure')).not.toBeInTheDocument()
  })

  it.each([
    [CAPTURE_OUTCOMES.FAILED, 'The extraction service could not be reached.'],
    [CAPTURE_OUTCOMES.TIMEOUT, 'No answer came back within 3 seconds.'],
    [CAPTURE_OUTCOMES.UNUSABLE, 'That did not come back as a minutes figure.'],
  ])('%s swaps the box for the sentence, keeps the manual field, and focuses it (AC 2)', async (outcome, sentence) => {
    const { onDescribe } = setup({ manualHint: 'Type the minutes instead.' })
    onDescribe.mockResolvedValue({ outcome, sentence })
    await describeIt('three hours')

    expect(box(), 'the description box is out of the way').not.toBeInTheDocument()
    const failure = screen.getByTestId('capture-failure')
    expect(failure).toHaveTextContent(sentence)
    expect(failure).toHaveTextContent('Type the minutes instead.')
    const typed = screen.getByLabelText('Typed minutes')
    expect(typed).toBeInTheDocument()
    expect(typed).toHaveFocus()
  })

  it('and offers a way back to describing', async () => {
    const { onDescribe } = setup()
    onDescribe.mockResolvedValue({ outcome: CAPTURE_OUTCOMES.FAILED, sentence: 'Down.' })
    await describeIt('three hours')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /describe it again/i })))
    expect(box()).toBeInTheDocument()
    expect(box()).toHaveValue('three hours')
    expect(screen.queryByTestId('capture-failure')).not.toBeInTheDocument()
  })

  it('the manual hint defaults to a neutral sentence, so the chore flow inherits one', async () => {
    const { onDescribe } = setup()
    onDescribe.mockResolvedValue({ outcome: CAPTURE_OUTCOMES.FAILED, sentence: 'Down.' })
    await describeIt('three hours')
    expect(screen.getByTestId('capture-failure')).toHaveTextContent('Type it in instead.')
  })

  it('a flow that throws is a failure, never an unhandled rejection', async () => {
    const { onDescribe } = setup()
    onDescribe.mockRejectedValue(new Error('Which household? A description must name one.'))
    await describeIt('three hours')
    expect(screen.getByTestId('capture-failure')).toHaveTextContent(/which household/i)
    expect(screen.getByLabelText('Typed minutes')).toBeInTheDocument()
  })
})
