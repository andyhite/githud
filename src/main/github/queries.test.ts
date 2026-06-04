import { describe, it, expect } from 'vitest'
import { buildDashboardQuery, teamSearchQuery, ownerScopeClause, labelSearchClause } from './queries'

describe('ownerScopeClause', () => {
  it('always includes the viewer’s own repos', () => {
    expect(ownerScopeClause('me', [])).toBe('user:me')
  })

  // GitHub's issues/PR search treats SPACE-separated user:/org: qualifiers as an
  // OR (verified empirically); the boolean `OR` operator does NOT work here and
  // silently zeroes the result. So owners are space-joined, no parens, no OR.
  it('space-joins the viewer with each configured org (implicit OR — no `OR` keyword)', () => {
    expect(ownerScopeClause('me', ['acme', 'globex'])).toBe('user:me org:acme org:globex')
  })

  it('works with orgs but no viewer login', () => {
    expect(ownerScopeClause(undefined, ['acme'])).toBe('org:acme')
  })

  it('returns null when there is nothing to scope to (so the caller skips a global search)', () => {
    expect(ownerScopeClause(undefined, [])).toBeNull()
    expect(ownerScopeClause(undefined, ['  '])).toBeNull()
  })

  it('caps at GitHub’s 16 user/org qualifier limit', () => {
    const orgs = Array.from({ length: 30 }, (_, i) => `org${i}`)
    const clause = ownerScopeClause('me', orgs)!
    expect(clause.match(/\b(user|org):/g)).toHaveLength(16)
  })
})

describe('labelSearchClause', () => {
  // A single `label:` qualifier with COMMA-separated quoted values is OR (any of
  // the labels). Separate `label:` qualifiers would AND instead — wrong here.
  it('quotes a single label', () => {
    expect(labelSearchClause(['frontend'])).toBe('label:"frontend"')
  })

  it('comma-joins multiple labels inside one qualifier (OR)', () => {
    expect(labelSearchClause(['frontend', 'bug'])).toBe('label:"frontend","bug"')
  })

  it('quotes labels with spaces', () => {
    expect(labelSearchClause(['needs design', 'bug'])).toBe('label:"needs design","bug"')
  })
})

describe('teamSearchQuery', () => {
  it('builds one open, non-draft PR search scoped to the owner clause + all labels, most-recent first', () => {
    expect(teamSearchQuery('user:me org:acme', ['frontend', 'bug'])).toBe(
      'is:open is:pr draft:false archived:false sort:updated-desc user:me org:acme label:"frontend","bug"'
    )
  })

  it('handles a single owner and a single label', () => {
    expect(teamSearchQuery('org:acme', ['frontend'])).toBe(
      'is:open is:pr draft:false archived:false sort:updated-desc org:acme label:"frontend"'
    )
  })

  it('excludes drafts (draft:false) so work-in-progress PRs never reach the Team panel', () => {
    expect(teamSearchQuery('user:me', ['x'])).toContain('draft:false')
  })
})

describe('buildDashboardQuery', () => {
  it('emits no team alias or variable when team is excluded', () => {
    const q = buildDashboardQuery(false)
    expect(q).not.toContain('team')
    expect(q).toContain('needsReview: search')
    expect(q).toContain('mine: search')
    // labels are fetched only for team PRs, so the no-team query never asks for them.
    expect(q).not.toContain('labels(first')
  })

  it('declares exactly one team variable and alias when team is included', () => {
    const q = buildDashboardQuery(true)
    expect(q).toContain('$team: String!')
    expect(q).toContain('team: search(query: $team')
    // all owners + labels collapse into ONE search, so there's never a team1.
    expect(q).not.toContain('team1')
    // team PRs use the lean fragment (labels yes; expensive comment bodies no).
    expect(q).toContain('labels(first: 10)')
  })

  it('keeps the expensive comment-body window out of team searches', () => {
    // needsReview/mine carry `bodyText` (for mention detection); team must not.
    const q = buildDashboardQuery(true)
    expect(q.match(/bodyText/g)?.length ?? 0).toBe(2) // needsReview + mine only, not team
  })
})
