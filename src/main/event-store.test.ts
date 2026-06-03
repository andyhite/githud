import { describe, it, expect } from 'vitest'
import { mergeEvents, applyRead, applyReadAll } from './event-store'
import type { FeedEvent } from '@shared/types'

function ev(id: string, createdAt: string, unread = true): FeedEvent {
  return { id, kind: 'comment', repo: 'o/web', number: 1, title: 't', url: 'u', createdAt, unread }
}

describe('mergeEvents', () => {
  it('adds new events and keeps the read-state of ones already stored', () => {
    const existing = [ev('a', '2026-06-02T00:00:00Z', false)]
    const incoming = [ev('a', '2026-06-02T00:00:00Z', true), ev('b', '2026-06-02T01:00:00Z')]
    const merged = mergeEvents(existing, incoming, 100)
    expect(merged.find((e) => e.id === 'a')!.unread).toBe(false) // not reset to unread
    expect(merged.map((e) => e.id)).toEqual(['b', 'a']) // newest first
  })

  it('caps to the most recent N', () => {
    const incoming = [ev('a', '2026-06-01T00:00:00Z'), ev('b', '2026-06-02T00:00:00Z'), ev('c', '2026-06-03T00:00:00Z')]
    expect(mergeEvents([], incoming, 2).map((e) => e.id)).toEqual(['c', 'b'])
  })
})

describe('applyRead / applyReadAll', () => {
  it('marks one event read by id', () => {
    const out = applyRead([ev('a', 'x'), ev('b', 'x')], 'a')
    expect(out.find((e) => e.id === 'a')!.unread).toBe(false)
    expect(out.find((e) => e.id === 'b')!.unread).toBe(true)
  })

  it('marks everything read', () => {
    expect(applyReadAll([ev('a', 'x'), ev('b', 'x')]).every((e) => !e.unread)).toBe(true)
  })
})
