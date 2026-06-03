import { existsSync, readFileSync, writeFileSync } from 'fs'
import { hiddenFilePath } from './paths'

export interface HiddenPr {
  id: string
  updatedAt: string // PR.updatedAt captured at hide time
}

// --- pure helpers (unit-tested) ---

// A stored entry stays hidden iff its PR is still present AND its updatedAt has
// not advanced past the value captured at hide time. Otherwise it's pruned:
// PR absent => merged/closed/fell out; updatedAt advanced => resurfaced.
export function resolveHidden(
  prs: { id: string; updatedAt: string }[],
  hidden: HiddenPr[]
): { hiddenIds: string[]; kept: HiddenPr[] } {
  const byId = new Map(prs.map((p) => [p.id, p]))
  const kept = hidden.filter((h) => {
    const pr = byId.get(h.id)
    if (!pr) return false
    return Date.parse(pr.updatedAt) <= Date.parse(h.updatedAt)
  })
  return { hiddenIds: kept.map((h) => h.id), kept }
}

export function applyHide(hidden: HiddenPr[], id: string, updatedAt: string): HiddenPr[] {
  return [...hidden.filter((h) => h.id !== id), { id, updatedAt }]
}

export function applyUnhide(hidden: HiddenPr[], id: string): HiddenPr[] {
  return hidden.filter((h) => h.id !== id)
}

// --- fs-backed store (glue) ---

export function loadHidden(): HiddenPr[] {
  const path = hiddenFilePath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HiddenPr[]
  } catch {
    return []
  }
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
