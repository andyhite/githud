import { contextBridge, ipcRenderer } from 'electron'
import type { GithudApi, DashboardSnapshot, Settings, DigestResult, PostReviewPayload } from '../shared/types'

const api: GithudApi = {
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  refresh: () => ipcRenderer.invoke('refresh'),
  onSnapshot: (cb) => {
    const listener = (_e: unknown, snap: DashboardSnapshot) => cb(snap)
    ipcRenderer.on('snapshot', listener)
    return () => ipcRenderer.removeListener('snapshot', listener)
  },
  onDigest: (cb) => {
    const listener = (_e: unknown, digest: DigestResult) => cb(digest)
    ipcRenderer.on('digest', listener)
    return () => ipcRenderer.removeListener('digest', listener)
  },
  onFullscreenChange: (cb) => {
    const listener = (_e: unknown, isFullscreen: boolean) => cb(isFullscreen)
    ipcRenderer.on('fullscreen-change', listener)
    // Seed the current state on subscribe so the initial render is correct
    // regardless of whether the window already started in fullscreen.
    void ipcRenderer.invoke('isFullscreen').then((v: boolean) => cb(v))
    return () => ipcRenderer.removeListener('fullscreen-change', listener)
  },
  getAuthStatus: () => ipcRenderer.invoke('getAuthStatus'),
  saveToken: (token: string) => ipcRenderer.invoke('saveToken', token),
  resetCredentials: () => ipcRenderer.invoke('resetCredentials'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('saveSettings', settings),
  listOrgs: () => ipcRenderer.invoke('listOrgs'),
  listTeams: () => ipcRenderer.invoke('listTeams'),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  sendTestNotification: () => ipcRenderer.invoke('sendTestNotification'),
  markRead: (id: string) => ipcRenderer.invoke('markRead', id),
  markAllRead: () => ipcRenderer.invoke('markAllRead'),
  hidePr: (id: string, updatedAt: string) => ipcRenderer.invoke('hidePr', id, updatedAt),
  unhidePr: (id: string) => ipcRenderer.invoke('unhidePr', id),
  snoozePr: (id: string, updatedAt: string, until: string) => ipcRenderer.invoke('snoozePr', id, updatedAt, until),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copyToClipboard', text),
  getAiStatus: () => ipcRenderer.invoke('getAiStatus'),
  saveAiKey: (key: string) => ipcRenderer.invoke('saveAiKey', key),
  clearAiCache: () => ipcRenderer.invoke('clearAiCache'),
  getTriage: (prId: string) => ipcRenderer.invoke('getTriage', prId),
  getDigest: () => ipcRenderer.invoke('getDigest'),
  getReview: (prId: string, force?: boolean) => ipcRenderer.invoke('getReview', prId, force),
  postReview: (prId: string, payload: PostReviewPayload) => ipcRenderer.invoke('postReview', prId, payload),
  getReviewInstructions: () => ipcRenderer.invoke('getReviewInstructions'),
  saveReviewInstructions: (text: string) => ipcRenderer.invoke('saveReviewInstructions', text),
  resetReviewInstructions: () => ipcRenderer.invoke('resetReviewInstructions')
}

contextBridge.exposeInMainWorld('api', api)
// Static platform string so the renderer can pad the TopBar clear of the macOS
// traffic lights (the frameless title bar) — not part of the IPC data contract.
contextBridge.exposeInMainWorld('platform', process.platform)
