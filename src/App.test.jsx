import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App.jsx'

describe('App shell', () => {
  // DELIBERATELY BROKEN - proving the CI gate can fail (AC 3 of #4).
  // Reverted in the commit immediately after this one.
  it('PROOF OF FAILURE: this assertion is false on purpose', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This is not the heading')
  })

  it('renders the product name as the page heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Taskr' })).toBeInTheDocument()
  })

  it('states the fairness rule the charter is built on', () => {
    render(<App />)
    expect(screen.getByText(/proportional to what each person actually has/i)).toBeInTheDocument()
  })

  it('labels the status region so it is reachable by assistive tech', () => {
    render(<App />)
    expect(screen.getByRole('region', { name: /shell deployed/i })).toBeInTheDocument()
  })
})
