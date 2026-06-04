import { app } from 'electron'
import { join } from 'path'

export function tokenFilePath(): string {
  return join(app.getPath('userData'), 'token.enc')
}
export function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}
export function snapshotFilePath(): string {
  return join(app.getPath('userData'), 'snapshot.json')
}
export function eventsFilePath(): string {
  return join(app.getPath('userData'), 'events.json')
}
export function prStateFilePath(): string {
  return join(app.getPath('userData'), 'pr-state.json')
}
export function hiddenFilePath(): string {
  return join(app.getPath('userData'), 'hidden.json')
}
export function historyFilePath(): string {
  return join(app.getPath('userData'), 'history.json')
}
export function aiKeyFilePath(): string {
  return join(app.getPath('userData'), 'ai-key.enc')
}
export function aiCacheFilePath(): string {
  return join(app.getPath('userData'), 'ai-cache.json')
}
export function reviewInstructionsFilePath(): string {
  return join(app.getPath('userData'), 'review-instructions.md')
}
