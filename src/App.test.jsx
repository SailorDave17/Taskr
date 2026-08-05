import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App.jsx'

describe('App shell', () => {
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

  // #4's "the deployed URL updates" cannot be checked from outside unless the
  // page says which build it is. A docs-only commit produces an identical
  // bundle, so without this the site looks the same whether a deploy ran or
  // not -- which is exactly how a production branch pointing at the wrong
  // branch went unnoticed. The assertion is that the stamp is present and
  // non-empty; its value is a build input and cannot be hardcoded here.
  it('stamps the running build so a deploy is observable from the browser', () => {
    render(<App />)
    const stamp = screen.getByTestId('build-commit')
    expect(stamp).toBeInTheDocument()
    expect(stamp.textContent.replace(/^build\s+/, '')).not.toBe('')
  })
})
