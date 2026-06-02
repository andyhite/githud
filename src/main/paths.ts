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
