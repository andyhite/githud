import { writeFileSync } from 'fs'
import { FeedEvent } from '@shared/types'
import { PRState } from './github/pr-state'
import { eventsFilePath, prStateFilePath } from './paths'
import { readJsonFile } from './json-file'

const CAP = 100

// --- pure helpers (unit-tested) ---

export function mergeEvents(existing: FeedEvent[], incoming: FeedEvent[], cap = CAP): FeedEvent[] {
  const byId = new Map(existing.map((e) => [e.id, e]))
  for (const e of incoming) {
    if (!byId.has(e.id)) byId.set(e.id, e) // existing keep their (possibly read) state
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, cap)
}

export function applyRead(events: FeedEvent[], id: string): FeedEvent[] {
  return events.map((e) => (e.id === id ? { ...e, unread: false } : e))
}

export function applyReadAll(events: FeedEvent[]): FeedEvent[] {
  return events.map((e) => (e.unread ? { ...e, unread: false } : e))
}

// --- fs-backed store (glue) ---

export function loadEvents(): FeedEvent[] {
  return readJsonFile<FeedEvent[]>(eventsFilePath(), [])
}

function save(events: FeedEvent[]): FeedEvent[] {
  writeFileSync(eventsFilePath(), JSON.stringify(events))
  return events
}

export function appendEvents(incoming: FeedEvent[]): FeedEvent[] {
  return save(mergeEvents(loadEvents(), incoming))
}

export function markRead(id: string): FeedEvent[] {
  return save(applyRead(loadEvents(), id))
}

export function markAllRead(): FeedEvent[] {
  return save(applyReadAll(loadEvents()))
}

// Prior PR state for diffing. `null` means "no baseline yet" (first run).
export function loadPrState(): PRState[] | null {
  return readJsonFile<PRState[] | null>(prStateFilePath(), null)
}

export function savePrState(states: PRState[]): void {
  writeFileSync(prStateFilePath(), JSON.stringify(states))
}
