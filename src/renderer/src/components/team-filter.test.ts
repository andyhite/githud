import { describe, it, expect } from 'vitest'
import { filterTeamPrs } from './team-filter'
import type { PullRequest } from '@shared/types'

function pr(id: string, labels: string[]): PullRequest {
  return { id, labels } as PullRequest
}

const prs = [
  pr('a', ['frontend']),
  pr('b', ['backend']),
  pr('c', ['frontend', 'backend']),
  pr('d', ['frontend', 'design'])
]

describe('filterTeamPrs', () => {
  it('shows every PR matching a configured label when nothing is muted', () => {
    expect(filterTeamPrs(prs, ['frontend', 'backend'], []).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('hides PRs whose only configured label is muted', () => {
    // muting "frontend" drops a and d (frontend-only among configured labels);
    // b stays (backend), c stays (still has backend active).
    expect(filterTeamPrs(prs, ['frontend', 'backend'], ['frontend']).map((p) => p.id)).toEqual(['b', 'c'])
  })

  it('shows nothing when every configured label is muted', () => {
    expect(filterTeamPrs(prs, ['frontend', 'backend'], ['frontend', 'backend'])).toEqual([])
  })

  it('ignores labels that are not configured when deciding visibility', () => {
    // "design" is not a configured chip, so it cannot keep d visible on its own.
    expect(filterTeamPrs([pr('d', ['design'])], ['frontend'], []).map((p) => p.id)).toEqual([])
  })
})
