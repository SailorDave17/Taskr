import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REPORT_ADDRESS,
  REPORT_FIELDS,
  SCREEN_FOR_STATUS,
  reportBody,
  reportHref,
  reportScreen,
  reportSubject,
} from './reportProblem.js'

// #425 — the footer's "Report a problem" link. Values are synthetic and
// deliberately lower-case where they are not a declared placeholder — see #19.

const FIELDS = {
  build: 'abc1234',
  environment: 'production',
  screen: 'Sign-in screen',
  browser: 'mozilla/5.0 (linux; android 14) placeholder',
}

/** Read a `mailto:` back the way a mail app would. */
function parse(href) {
  const url = new URL(href)
  return {
    protocol: url.protocol,
    to: url.pathname,
    keys: [...url.searchParams.keys()],
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body'),
  }
}

describe('the report link (#425)', () => {
  it('opens a message to the published address, with a subject and a body and nothing else', () => {
    const message = parse(reportHref(FIELDS))
    expect(message.protocol).toBe('mailto:')
    expect(message.to).toBe(REPORT_ADDRESS)
    expect(message.keys).toEqual(['subject', 'body'])
  })

  it('names the build in the subject, so a report is sortable before it is opened', () => {
    expect(parse(reportHref(FIELDS)).subject).toBe(reportSubject(FIELDS))
    expect(reportSubject(FIELDS)).toContain('abc1234')
  })

  it('carries the build, the environment, the screen and the browser, one line each', () => {
    const body = parse(reportHref(FIELDS)).body
    expect(body).toContain('Build: abc1234')
    expect(body).toContain('Environment: production')
    expect(body).toContain('Screen: Sign-in screen')
    expect(body).toContain('Browser: mozilla/5.0 (linux; android 14) placeholder')
  })

  it('carries NOTHING it was not asked for: household data passed in is ignored', () => {
    // The allowlist is the whole privacy argument, so this test hands the link
    // everything a careless caller might, and asserts none of it arrives.
    const leaky = {
      ...FIELDS,
      household: 'placeholder household',
      member: 'Alex',
      email: 'alex@example.com',
      id: '00000000-0000-4000-8000-000000000001',
      chore: 'placeholder chore title',
    }
    const message = parse(reportHref(leaky))
    for (const value of [leaky.household, leaky.member, leaky.email, leaky.id, leaky.chore]) {
      expect(message.body).not.toContain(value)
      expect(message.subject).not.toContain(value)
    }
    const detailLines = message.body.split('\r\n').slice(message.body.split('\r\n').indexOf('---') + 1)
    expect(detailLines).toHaveLength(REPORT_FIELDS.length)
  })

  it('keeps a value holding & # ? + and % inside its own parameter', () => {
    const hostile = { ...FIELDS, browser: 'ua & more #frag ?q=1 +plus %41 end' }
    const message = parse(reportHref(hostile))
    expect(message.keys).toEqual(['subject', 'body'])
    expect(message.body).toContain('Browser: ua & more #frag ?q=1 +plus %41 end')
    expect(message.body.endsWith('end')).toBe(true)
  })

  it('breaks lines with CRLF, as RFC 6068 asks of a mailto body', () => {
    expect(reportBody(FIELDS)).toContain('\r\n')
    expect(reportBody(FIELDS).replace(/\r\n/g, '')).not.toContain('\n')
    expect(reportHref(FIELDS)).toContain('%0D%0A')
  })

  it('says unknown, never undefined or blank, for a field the caller did not have', () => {
    const body = reportBody({})
    expect(body).not.toMatch(/undefined|null/)
    for (const [, label] of REPORT_FIELDS) expect(body).toContain(`${label}: unknown`)
    expect(reportSubject({ build: '' })).toContain('(build unknown)')
  })
})

describe('the Screen line (#425)', () => {
  const surfaces = [
    { key: 'split', label: 'Split' },
    { key: 'chores', label: 'Chores' },
  ]

  it('names the tab the person is on, in the tab strip\'s own words', () => {
    expect(reportScreen({ status: 'joined', view: 'chores', surfaces })).toBe('Chores')
    expect(reportScreen({ status: 'joined', view: 'split', surfaces })).toBe('Split')
  })

  it('falls back to the view key, then unknown, rather than to nothing', () => {
    expect(reportScreen({ status: 'joined', view: 'later', surfaces })).toBe('later')
    expect(reportScreen({ status: 'joined', surfaces })).toBe('unknown')
    expect(reportScreen({})).toBe('unknown')
  })

  it('names each screen outside a household, distinctly', () => {
    for (const [status, label] of Object.entries(SCREEN_FOR_STATUS)) {
      expect(reportScreen({ status, view: 'split', surfaces })).toBe(label)
    }
    const labels = Object.values(SCREEN_FOR_STATUS)
    expect(new Set(labels).size).toBe(labels.length)
    expect(reportScreen({ status: 'onboarding', surfaces })).toBe('Onboarding screen')
  })
})

describe('what the report module does NOT do (#425)', () => {
  it('talks to no server: it builds a string and the person sends it', () => {
    // Through process.cwd(), as gate.test.js reads source: under vitest
    // `import.meta.url` is not a file: URL, so readFileSync refuses it.
    const source = readFileSync(`${process.cwd()}/src/lib/reportProblem.js`, 'utf8')
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|from ['"]/)
  })

  it('POSITIVE CONTROL: that scan finds a network call when one is there', () => {
    const planted = "import { supabase } from './supabase.js'\nfetch('/x')"
    expect(planted).toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|from ['"]/)
  })
})
