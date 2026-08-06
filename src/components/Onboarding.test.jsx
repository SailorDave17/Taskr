import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Onboarding from './Onboarding.jsx'

/** Click, and let the submit handler's promise settle inside act(). */
const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

// AC 1 (create a household and learn the credential) and the entry half of
// AC 5 (a phone joins with that credential). Names are synthetic — see #19.

function setup(overrides = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onJoin = vi.fn().mockResolvedValue(undefined)
  render(<Onboarding onCreate={onCreate} onJoin={onJoin} {...overrides} />)
  return { onCreate, onJoin }
}

const codeBox = () => screen.getByLabelText(/join code/i)
const joinButton = () => screen.getByRole('button', { name: /join household/i })

describe('starting a household', () => {
  it('will not submit an unnamed household', () => {
    setup()
    expect(screen.getByRole('button', { name: /create household/i })).toBeDisabled()
  })

  it('creates the household with the name that was typed', async () => {
    const { onCreate } = setup()
    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'Placeholder Household' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Placeholder Organizer' },
    })
    fireEvent.change(screen.getByLabelText(/your pin/i), { target: { value: '4821' } })
    await clickAndSettle(screen.getByRole('button', { name: /create household/i }))
    expect(onCreate).toHaveBeenCalledWith('Placeholder Household', {
      organizerName: 'Placeholder Organizer',
      organizerPin: '4821',
    })
  })

  it('shows the reason when the backend refuses, instead of failing silently', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('Anonymous sign-ins are disabled'))
    render(<Onboarding onCreate={onCreate} onJoin={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'Placeholder Household' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Placeholder Organizer' },
    })
    fireEvent.change(screen.getByLabelText(/your pin/i), { target: { value: '4821' } })
    fireEvent.click(screen.getByRole('button', { name: /create household/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/anonymous sign-ins are disabled/i)
  })
})

describe('joining with a code', () => {
  it('stays disabled until the code is the full length', () => {
    setup()
    expect(joinButton()).toBeDisabled()

    fireEvent.change(codeBox(), { target: { value: 'ABCD234' } }) // seven
    expect(joinButton()).toBeDisabled()

    fireEvent.change(codeBox(), { target: { value: 'ABCD2345' } }) // eight
    expect(joinButton()).toBeEnabled()
  })

  // A code is read aloud in fours and typed with a space or a hyphen. If the box
  // kept what was typed, the value sent would differ from the value shown.
  it('normalizes a code typed the way one is read out', async () => {
    const { onJoin } = setup()
    fireEvent.change(codeBox(), { target: { value: 'abcd-2345' } })

    expect(codeBox()).toHaveValue('ABCD2345')
    await clickAndSettle(joinButton())
    expect(onJoin).toHaveBeenCalledWith('ABCD2345')
  })

  it('reports a wrong code without hinting which part was wrong', async () => {
    const onJoin = vi.fn().mockRejectedValue(new Error('no household matches that code'))
    render(<Onboarding onCreate={vi.fn()} onJoin={onJoin} />)

    fireEvent.change(codeBox(), { target: { value: 'ZZZZZZZZ' } })
    fireEvent.click(joinButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no household matches that code/i)
    // The vagueness is the feature: distinguishing "wrong code" from "no such
    // household" is free information for someone guessing.
    expect(alert).not.toHaveTextContent(/malformed|invalid character|too short/i)
  })
})

describe('while a request is in flight', () => {
  it('disables both actions, so a double tap cannot join twice', () => {
    setup({ busy: true })
    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'Placeholder Household' },
    })
    fireEvent.change(codeBox(), { target: { value: 'ABCD2345' } })

    expect(screen.getByRole('button', { name: /create household/i })).toBeDisabled()
    expect(joinButton()).toBeDisabled()
  })
})
