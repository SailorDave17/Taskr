import { describe, expect, it } from 'vitest'

import {
  ATTACHMENT_PREFIX,
  ISSUES_QUERY,
  NIL_UUID,
  PLACEHOLDER_EMAIL_DOMAINS,
  COMMENT_PAGE,
  ISSUE_FIELD_COUNTS,
  PULLS_QUERY,
  PULL_PAGE,
  REQUIRED_ITEM_FIELDS,
  PULL_FIELD_COUNTS,
  REQUIRED_PULL_FIELDS,
  REVIEW_COMMENT_PAGE,
  REVIEW_PAGE,
  assertReportCarriesNoValues,
  classify,
  controlMisses,
  countField,
  controlRecord,
  expectedControlClasses,
  findingsFor,
  formatReport,
  isAttachmentId,
  isPlaceholderDomain,
  maskTerm,
  queryNamesField,
  resolveTerms,
  truncationErrors,
} from './scan-tracker.mjs'

// #328 — `npm run scan:tracker`.
//
// The half these tests can settle is WHAT COUNTS as a live identifier and WHAT
// THE REPORT IS ALLOWED TO SAY. Whether the tracker currently carries any is a
// question about GitHub's answer on the day, which is the workflow's job and is
// recorded on the issue.
//
// Every fixture identifier below is invented for this file. The real ones are
// not written down here, which is the whole point of the script.

const LIVE_SHAPED_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const OTHER_UUID = '7d444840-9dc0-11d1-b245-5ffdce74fad2'

describe('#328 classify — what counts as a live identifier', () => {
  it('finds a version-4-shaped uuid', () => {
    expect([...classify(`household ${LIVE_SHAPED_UUID} was created`)]).toEqual(['uuid'])
  })

  it('finds an address at a domain that is not a placeholder', () => {
    expect([...classify('organiser is somebody@a-real-looking-domain.co')]).toEqual(['email'])
  })

  it('reports one class however many times it matches, so the count is of ITEMS not values', () => {
    const text = `${LIVE_SHAPED_UUID} and ${OTHER_UUID}`
    expect([...classify(text)]).toEqual(['uuid'])
  })

  // The pattern is now ANY 8-4-4-4-12 hex, so it MATCHES the nil UUID and the
  // guard is what excludes it. That is the point of the widening: until #328's
  // review the version/variant nibbles rejected the nil UUID themselves, this
  // test passed on the pattern, and the guard it is named for was dead code.
  // Delete the guard now and this reddens.
  it('ignores the nil uuid, which names no row — and the GUARD is what does it', () => {
    expect([...classify(`the id is ${NIL_UUID}`)]).toEqual([])
    // The pattern must still reach it, or the guard is unexercised again.
    expect(NIL_UUID.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)).not.toBeNull()
  })

  // v7 is what a modern generator produces, and the old version-nibble bound
  // rejected it — a live coverage gap wearing the clothes of precision.
  it.each([
    ['v1', '7d444840-9dc0-11d1-b245-5ffdce74fad2'],
    ['v4', '3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    ['v7', '018f7b2c-9d3e-7abc-8def-0123456789ab'],
    ['a non-RFC variant nibble', '3f2504e0-4f89-41d3-0a0c-0305e82c3301'],
  ])('finds a %s uuid', (_label, uuid) => {
    expect([...classify(`household ${uuid}`)]).toEqual(['uuid'])
  })

  // The list's LENGTH is asserted because the cases below are generated from it.
  // Measured 2026-09-10: emptying PLACEHOLDER_EMAIL_DOMAINS took the suite from
  // 42 tests to 29 and reddened only 2 — thirteen cases did not fail, they
  // ceased to exist, and vitest reports a suite that shrank exactly like one
  // that was always that size. A generated case can only defend its input while
  // something else defends the count.
  it('is generated from a non-empty list of the expected length', () => {
    expect(PLACEHOLDER_EMAIL_DOMAINS.length).toBe(13)
  })

  it.each(PLACEHOLDER_EMAIL_DOMAINS)('ignores an address at %s', (domain) => {
    expect([...classify(`write to somebody@${domain}`)]).toEqual([])
  })

  it('ignores a subdomain of a placeholder domain', () => {
    expect([...classify('write to somebody@mail.example.com')]).toEqual([])
  })

  it('does NOT ignore taskr.invalid, whose local part encodes a live member id', () => {
    // #246/#247/#262: a provisioned member's synthetic address is their
    // `members.id` with a domain stuck on it. Excluding the domain would exclude
    // a live row id wearing an address's shape.
    const hits = [...classify(`auth user holds ${LIVE_SHAPED_UUID}@taskr.invalid`)]
    expect(hits).toContain('email')
  })

  it('returns nothing for text with no identifiers', () => {
    expect([...classify('a chore was completed and the split rebalanced')]).toEqual([])
  })

  it('returns nothing for empty or missing text', () => {
    expect([...classify('')]).toEqual([])
    expect([...classify(undefined)]).toEqual([])
  })
})

describe('#328 classify — the attachment exclusion', () => {
  const url = `https://${ATTACHMENT_PREFIX}${LIVE_SHAPED_UUID}`

  it('ignores a uuid that is a GitHub attachment id', () => {
    expect([...classify(`<img src="${url}" />`)]).toEqual([])
  })

  it('still finds the same uuid when it is NOT in an attachment URL', () => {
    // The positive control for the exclusion: the rule must be about the
    // CONTEXT, not about the value. Without this, an exclusion that swallowed
    // the value everywhere would pass the test above and report clean forever.
    expect([...classify(`household ${LIVE_SHAPED_UUID}`)]).toEqual(['uuid'])
  })

  it('finds a live id in the same text as an attachment URL', () => {
    expect([...classify(`<img src="${url}" /> and household ${OTHER_UUID}`)]).toEqual(['uuid'])
  })

  it('isAttachmentId reads the text BEHIND the id', () => {
    const text = `x${ATTACHMENT_PREFIX}${LIVE_SHAPED_UUID}`
    expect(isAttachmentId(text, text.indexOf(LIVE_SHAPED_UUID))).toBe(true)
    expect(isAttachmentId(`plain ${LIVE_SHAPED_UUID}`, 6)).toBe(false)
  })

  it('isPlaceholderDomain matches whole domains and subdomains only', () => {
    expect(isPlaceholderDomain('example.com')).toBe(true)
    expect(isPlaceholderDomain('mail.example.com')).toBe(true)
    // A domain that merely ENDS with the letters of a placeholder is a
    // different domain. `notexample.com` is somebody's real domain.
    expect(isPlaceholderDomain('notexample.com')).toBe(false)
  })
})

describe('#328 classify — the term half', () => {
  const terms = ['Placeholder Household', 'someone@a-real-looking-domain.co']

  it('finds a literal term and reports it MASKED', () => {
    const hits = [...classify('measured on Placeholder Household today', terms)]
    expect(hits).toEqual(['term:name:Pl…21ch'])
  })

  it('matches a term case-insensitively', () => {
    expect([...classify('measured on placeholder household', terms)]).toEqual(['term:name:Pl…21ch'])
  })

  it('masks an address term as local-length plus domain', () => {
    expect(maskTerm('someone@a-real-looking-domain.co')).toBe('mail:so…7ch@a-real-looking-domain.co')
  })

  it('searches for no terms when none are supplied, and says nothing about them', () => {
    expect([...classify('measured on Placeholder Household today')]).toEqual([])
  })
})

describe('#328 findingsFor — where a hit is decides the remedy', () => {
  const item = {
    kind: 'issue',
    number: 241,
    title: 'a title with nothing in it',
    body: `created household ${LIVE_SHAPED_UUID}`,
    createdAt: '2026-08-28T04:10:11Z',
    comments: {
      nodes: [
        { body: 'no identifiers here', createdAt: '2026-08-28T05:00:00Z' },
        { body: 'organiser is somebody@a-real-looking-domain.co', createdAt: '2026-08-31T16:15:21Z' },
      ],
    },
  }

  it('separates a body hit from a comment hit, because only a comment can be deleted', () => {
    expect(findingsFor([item])).toEqual([
      {
        kind: 'issue',
        number: 241,
        places: [
          { where: 'body', written: '2026-08-28', hits: ['uuid'] },
          { where: 'comment 2', written: '2026-08-31', hits: ['email'] },
        ],
      },
    ])
  })

  it('scans the title too', () => {
    const titled = { ...item, title: `household ${LIVE_SHAPED_UUID}`, body: '', comments: { nodes: [] } }
    expect(findingsFor([titled])[0].places).toEqual([{ where: 'title', written: '2026-08-28', hits: ['uuid'] }])
  })

  it('returns nothing for an item that carries nothing', () => {
    expect(findingsFor([{ kind: 'issue', number: 1, title: 'x', body: 'y', comments: { nodes: [] } }])).toEqual([])
  })

  it('tolerates an item with no comments field', () => {
    expect(findingsFor([{ kind: 'pr', number: 9, title: '', body: `id ${LIVE_SHAPED_UUID}` }])).toHaveLength(1)
  })

  // THE TERM HALF'S ONLY PATH INTO A REAL REPORT. Every other findingsFor case
  // here calls it with one argument, so until #328's review, dropping `terms`
  // inside findingsFor was a zero-red mutation — measured, 43 passed / 0 failed
  // — while a live run still printed "term half: ON, N term(s)".
  it('forwards terms to classify, for the body and for a comment', () => {
    const found = findingsFor(
      [
        {
          kind: 'issue',
          number: 1,
          title: '',
          body: 'measured on Placeholder Household',
          comments: { nodes: [{ body: 'and again on Placeholder Household' }] },
        },
      ],
      ['Placeholder Household'],
    )
    expect(found[0].places).toEqual([
      { where: 'body', written: 'undated', hits: ['term:name:Pl…21ch'] },
      { where: 'comment 1', written: 'undated', hits: ['term:name:Pl…21ch'] },
    ])
  })

  it('records WHEN each place was written, which is half of what AC 1 asked for', () => {
    const found = findingsFor([
      {
        kind: 'issue',
        number: 1,
        title: '',
        body: `id ${LIVE_SHAPED_UUID}`,
        createdAt: '2026-08-28T04:10:11Z',
        comments: { nodes: [{ body: `id ${OTHER_UUID}`, createdAt: '2026-09-05T23:09:14Z' }] },
      },
    ])
    expect(found[0].places.map((p) => p.written)).toEqual(['2026-08-28', '2026-09-05'])
  })

  it('walks a pull request review body and its inline comments', () => {
    // A pull request has THREE writable text surfaces. Until #328's review only
    // the conversation tab was fetched, so an id pasted into a code review was
    // invisible to every route into the script.
    const found = findingsFor([
      {
        kind: 'pr',
        number: 7,
        title: '',
        body: '',
        createdAt: '2026-09-01T00:00:00Z',
        comments: { nodes: [] },
        reviews: {
          nodes: [
            {
              body: `looks like ${LIVE_SHAPED_UUID}`,
              createdAt: '2026-09-02T00:00:00Z',
              comments: { nodes: [{ body: 'and somebody@a-real-looking-domain.co', createdAt: '2026-09-03T00:00:00Z' }] },
            },
          ],
        },
      },
    ])
    expect(found[0].places).toEqual([
      { where: 'review 1', written: '2026-09-02', hits: ['uuid'] },
      { where: 'review 1 comment 1', written: '2026-09-03', hits: ['email'] },
    ])
  })
})

describe('#328 formatReport — item numbers, dates and classes, never values', () => {
  it('names the item, the place and the classes', () => {
    const findings = findingsFor([
      { kind: 'issue', number: 241, title: '', body: `id ${LIVE_SHAPED_UUID}`, createdAt: '2026-08-28T04:10:11Z', comments: { nodes: [] } },
    ])
    expect(formatReport(findings)).toEqual(['issue #241: body (2026-08-28) [uuid]'])
  })

  it('says so plainly when there is nothing', () => {
    expect(formatReport([])).toEqual(['no live identifiers found'])
  })

  it('never carries the value it matched', () => {
    const findings = findingsFor([
      { kind: 'issue', number: 241, title: '', body: `id ${LIVE_SHAPED_UUID}`, comments: { nodes: [] } },
    ])
    expect(formatReport(findings).join('\n')).not.toContain(LIVE_SHAPED_UUID)
  })
})

describe('#328 assertReportCarriesNoValues — the leak guard', () => {
  it('passes a masked report', () => {
    expect(assertReportCarriesNoValues(['issue #241: body [term:name:Pl…21ch]'], ['Placeholder Household'])).toBe(true)
  })

  it('REFUSES a report that carries a term verbatim', () => {
    expect(() =>
      assertReportCarriesNoValues(['issue #241: body [Placeholder Household]'], ['Placeholder Household']),
    ).toThrow(/carries 1 search term/)
  })

  it('refuses case-insensitively, because a report may reflow what it read', () => {
    expect(() =>
      assertReportCarriesNoValues(['issue #241: placeholder household'], ['Placeholder Household']),
    ).toThrow(/refusing to print it/)
  })

  it('passes when there are no terms at all', () => {
    expect(assertReportCarriesNoValues(['no live identifiers found'], [])).toBe(true)
  })
})

describe('#328 the positive control', () => {
  it('fires for both shape classes, THROUGH findingsFor', () => {
    // "no live identifiers found" is also what a scanner matching nothing at all
    // prints. This is the only thing that tells the two apart — and it has to
    // travel the same function the corpus travels, or it proves only that
    // `classify` works while the delivery path is what fails toward clean.
    expect(controlMisses()).toEqual([])
    expect(expectedControlClasses()).toEqual(['email', 'uuid'])
  })

  it('plants a term and requires it found when terms are supplied', () => {
    const terms = ['Placeholder Household']
    expect(expectedControlClasses(terms)).toEqual(['email', 'term:name:Pl…21ch', 'uuid'])
    expect(controlMisses(terms)).toEqual([])
  })

  it('plants no term when none are supplied, and does not claim one', () => {
    expect(expectedControlClasses([])).not.toContain(expect.stringContaining('term:'))
    expect(controlRecord([]).comments.nodes).toEqual([])
  })

  it('ignores a term too short to be a meaningful control', () => {
    expect(expectedControlClasses(['ab'])).toEqual(['email', 'uuid'])
  })

  it('travels findingsFor, so a break in the item walk fails the control', () => {
    // The regression this exists for: drop `terms` inside findingsFor and the
    // term class stops appearing here, on every run, before anything is printed.
    const found = findingsFor([controlRecord(['Placeholder Household'])], ['Placeholder Household'])
    expect(found).toHaveLength(1)
    const hits = found[0].places.flatMap((p) => p.hits)
    expect(hits).toContain('uuid')
    expect(hits).toContain('term:name:Pl…21ch')
  })
})

describe('#328 the field selection names every key findingsFor reads', () => {
  // The one delivery stage the control cannot reach: it never goes near GraphQL.
  // A field renamed to a VALID-but-wrong one (`bodyText`, `bodyHTML`) returns no
  // error, so `fetchAll`'s exit-2 branch never fires and every item classifies
  // empty. This is what stands in for a control there.
  // COUNTS, not presence. Presence was the first draft and it did not work:
  // `createdAt` is selected at the item level AND inside every comment
  // connection, so deleting the item-level one left the query still "naming"
  // it — measured, that mutation reddened 0 of a predicted 2. The count moves
  // when any single occurrence goes.
  it.each(Object.entries(ISSUE_FIELD_COUNTS))('the issues query selects %s exactly %i time(s)', (field, n) => {
    expect(countField(ISSUES_QUERY, field)).toBe(n)
  })

  it.each(Object.entries(PULL_FIELD_COUNTS))('the pull request query selects %s exactly %i time(s)', (field, n) => {
    expect(countField(PULLS_QUERY, field)).toBe(n)
  })

  it('the count maps cover every field findingsFor reads, and cannot silently shrink', () => {
    expect(Object.keys(ISSUE_FIELD_COUNTS).sort()).toEqual([...REQUIRED_ITEM_FIELDS].sort())
    expect(Object.keys(PULL_FIELD_COUNTS).sort()).toEqual([...REQUIRED_PULL_FIELDS].sort())
    expect(REQUIRED_ITEM_FIELDS.length).toBe(5)
    expect(REQUIRED_PULL_FIELDS.length).toBe(6)
  })

  it('countField matches whole words only', () => {
    expect(countField('nodes { body }', 'body')).toBe(1)
    // The mutation this defends against: `body` renamed to `bodyText`, which is
    // a real field on both types and so returns no error.
    expect(countField('nodes { bodyText }', 'body')).toBe(0)
    expect(queryNamesField('nodes { bodyText }', 'body')).toBe(false)
  })

  it('both queries request totalCount, the only truncation signal there is', () => {
    expect(ISSUES_QUERY).toContain('totalCount')
    expect(PULLS_QUERY).toContain('totalCount')
  })
})

describe('#328 truncationErrors — a partial scan must not report clean', () => {
  const at = (n) => ({ kind: 'issue', number: 1, comments: { totalCount: n, nodes: [] } })

  it('accepts a connection exactly at its cap', () => {
    expect(truncationErrors([at(COMMENT_PAGE)])).toEqual([])
  })

  it('refuses a connection one over its cap', () => {
    expect(truncationErrors([at(COMMENT_PAGE + 1)])[0]).toMatch(/comments exceeds the/)
  })

  it('refuses a truncated review connection', () => {
    expect(
      truncationErrors([{ kind: 'pr', number: 2, reviews: { totalCount: REVIEW_PAGE + 1, nodes: [] } }])[0],
    ).toMatch(/reviews exceeds the/)
  })

  it('refuses a truncated review THREAD', () => {
    expect(
      truncationErrors([
        {
          kind: 'pr',
          number: 2,
          reviews: { totalCount: 1, nodes: [{ comments: { totalCount: REVIEW_COMMENT_PAGE + 1, nodes: [] } }] },
        },
      ])[0],
    ).toMatch(/review thread has/)
  })

  it('tolerates an item with no connections at all', () => {
    expect(truncationErrors([{ kind: 'issue', number: 3 }])).toEqual([])
  })

  // The caps and the queries must agree by construction, or the scan fetches
  // fewer than it checks for and under-reports in silence.
  it('the queries ask for exactly the page sizes the caps assert', () => {
    expect(ISSUES_QUERY).toContain(`comments(first: ${COMMENT_PAGE})`)
    expect(PULLS_QUERY).toContain(`comments(first: ${COMMENT_PAGE})`)
    expect(PULLS_QUERY).toContain(`reviews(first: ${REVIEW_PAGE})`)
    expect(PULLS_QUERY).toContain(`comments(first: ${REVIEW_COMMENT_PAGE})`)
  })

  // GitHub refuses a query over 500,000 nodes, and the first review-aware draft
  // breached it at 510,000 with MAX_NODE_LIMIT_EXCEEDED.
  it('the pull request query stays under the GitHub node limit', () => {
    const worstCase = PULL_PAGE * (COMMENT_PAGE + REVIEW_PAGE * (1 + REVIEW_COMMENT_PAGE))
    expect(worstCase).toBeLessThan(500000)
  })
})

describe('#328 resolveTerms — the flag must not lie about the invocation', () => {
  it('reports the flag absent when it is absent', () => {
    expect(resolveTerms([])).toEqual({ terms: [], path: null, given: false })
  })

  it('REFUSES the flag with no path, rather than reporting it was never given', () => {
    // The defect this closes: `--names-file` as the last argument used to take
    // the same branch as the flag being absent, and print "no --names-file
    // given" — a false statement about what the operator actually typed.
    expect(() => resolveTerms(['--names-file'])).toThrow(/no path after it/)
  })

  it('REFUSES the flag followed by another flag', () => {
    expect(() => resolveTerms(['--names-file', '--verbose'])).toThrow(/no path after it/)
  })

  it('reads the terms when a path is given', () => {
    expect(resolveTerms(['--names-file', 'x.txt'], () => ['Placeholder Household'])).toEqual({
      terms: ['Placeholder Household'],
      path: 'x.txt',
      given: true,
    })
  })

  it('reports given:true with zero terms, so the banner can say WHICH is true', () => {
    expect(resolveTerms(['--names-file', 'empty.txt'], () => [])).toEqual({
      terms: [],
      path: 'empty.txt',
      given: true,
    })
  })
})
