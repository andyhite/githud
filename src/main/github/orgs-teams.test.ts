import { describe, it, expect } from 'vitest'
import { normalizeOrgs, normalizeTeams, classifyListError } from './orgs-teams'

describe('normalizeOrgs', () => {
  it('extracts org logins, sorted case-insensitively, dropping blanks', () => {
    expect(normalizeOrgs([{ login: 'globex' }, { login: 'Acme' }, {}, { login: '' }])).toEqual(['Acme', 'globex'])
  })

  it('dedupes repeated orgs', () => {
    expect(normalizeOrgs([{ login: 'acme' }, { login: 'acme' }])).toEqual(['acme'])
  })

  it('tolerates an empty/missing payload', () => {
    expect(normalizeOrgs([])).toEqual([])
  })
})

describe('normalizeTeams', () => {
  it('builds "org/team" slugs from the team slug + organization login', () => {
    const payload = [
      { slug: 'frontend', name: 'Frontend', organization: { login: 'acme' } },
      { slug: 'platform', name: 'Platform Eng', organization: { login: 'globex' } }
    ]
    expect(normalizeTeams(payload)).toEqual([
      { slug: 'acme/frontend', name: 'Frontend', org: 'acme' },
      { slug: 'globex/platform', name: 'Platform Eng', org: 'globex' }
    ])
  })

  it('falls back to the slug for the display name when name is missing', () => {
    expect(normalizeTeams([{ slug: 'frontend', organization: { login: 'acme' } }])[0].name).toBe('frontend')
  })

  it('drops teams missing an org or slug, and sorts by slug', () => {
    const payload = [
      { slug: 'b-team', name: 'B', organization: { login: 'z' } },
      { slug: 'orphan' }, // no organization → dropped
      { name: 'No slug', organization: { login: 'acme' } }, // no slug → dropped
      { slug: 'a-team', name: 'A', organization: { login: 'acme' } }
    ]
    expect(normalizeTeams(payload).map((t) => t.slug)).toEqual(['acme/a-team', 'z/b-team'])
  })
})

describe('classifyListError', () => {
  it('treats 401/403 as a missing-scope problem (read:org)', () => {
    expect(classifyListError({ status: 403 })).toBe('scope')
    expect(classifyListError({ status: 401 })).toBe('scope')
  })

  it('treats a status-less error as a network problem', () => {
    expect(classifyListError({ message: 'getaddrinfo ENOTFOUND' })).toBe('network')
  })

  it('classifies anything else as unknown', () => {
    expect(classifyListError({ status: 500 })).toBe('unknown')
  })
})
