import { writeFileSync } from 'fs'
import { hiddenFilePath } from './paths'
import { readJsonFile } from './json-file'

export interface HiddenPr {
  id: string
  updatedAt: string // PR.updatedAt captured at hide time
  snoozeUntil?: string // if set, the entry is a snooze that expires at this ISO time
}

// --- pure helpers (unit-tested) ---

// A stored entry stays hidden iff its PR is still present AND its updatedAt has
// not advanced past the value captured at hide time. Otherwise it's pruned:
// PR absent => merged/closed/fell out; updatedAt advanced => resurfaced.
// For snooze entries, expiry is also checked against `now`.
export function resolveHidden(
  prs: { id: string; updatedAt: string }[],
  hidden: HiddenPr[],
  now: number
): { hiddenIds: string[]; kept: HiddenPr[] } {
  const byId = new Map(prs.map((p) => [p.id, p]))
  const kept = hidden.filter((h) => {
    const pr = byId.get(h.id)
    if (!pr) return false
    if (Date.parse(pr.updatedAt) > Date.parse(h.updatedAt)) return false // resurfaced on new activity
    if (h.snoozeUntil && now >= Date.parse(h.snoozeUntil)) return false // snooze expired
    return true
  })
  return { hiddenIds: kept.map((h) => h.id), kept }
}

export function applyHide(hidden: HiddenPr[], id: string, updatedAt: string): HiddenPr[] {
  return [...hidden.filter((h) => h.id !== id), { id, updatedAt }]
}

export function applyUnhide(hidden: HiddenPr[], id: string): HiddenPr[] {
  return hidden.filter((h) => h.id !== id)
}

export function applySnooze(hidden: HiddenPr[], id: string, updatedAt: string, until: string): HiddenPr[] {
  return [...hidden.filter((h) => h.id !== id), { id, updatedAt, snoozeUntil: until }]
}

// --- fs-backed store (glue) ---

export function loadHidden(): HiddenPr[] {
  return readJsonFile<HiddenPr[]>(hiddenFilePath(), [])
}

export function saveHidden(hidden: HiddenPr[]): HiddenPr[] {
  writeFileSync(hiddenFilePath(), JSON.stringify(hidden))
  return hidden
}

export function hidePr(id: string, updatedAt: string): HiddenPr[] {
  return saveHidden(applyHide(loadHidden(), id, updatedAt))
}

export function unhidePr(id: string): HiddenPr[] {
  return saveHidden(applyUnhide(loadHidden(), id))
}

export function snoozePr(id: string, updatedAt: string, until: string): HiddenPr[] {
  return saveHidden(applySnooze(loadHidden(), id, updatedAt, until))
}
