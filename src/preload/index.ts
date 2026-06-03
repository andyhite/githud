import { contextBridge, ipcRenderer } from 'electron'
import type { GithudApi, DashboardSnapshot, Settings } from '../shared/types'

const api: GithudApi = {
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  refresh: () => ipcRenderer.invoke('refresh'),
  onSnapshot: (cb) => {
    const listener = (_e: unknown, snap: DashboardSnapshot) => cb(snap)
    ipcRenderer.on('snapshot', listener)
    return () => ipcRenderer.removeListener('snapshot', listener)
  },
  getAuthStatus: () => ipcRenderer.invoke('getAuthStatus'),
  saveToken: (token: string) => ipcRenderer.invoke('saveToken', token),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('saveSettings', settings),
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  markRead: (id: string) => ipcRenderer.invoke('markRead', id),
  markAllRead: () => ipcRenderer.invoke('markAllRead'),
  hidePr: (id: string, updatedAt: string) => ipcRenderer.invoke('hidePr', id, updatedAt),
  unhidePr: (id: string) => ipcRenderer.invoke('unhidePr', id),
  snoozePr: (id, updatedAt, until) => ipcRenderer.invoke('snoozePr', id, updatedAt, until),
  copyToClipboard: (text) => ipcRenderer.invoke('copyToClipboard', text),
  getAiStatus: () => ipcRenderer.invoke('getAiStatus'),
  saveAiKey: (key) => ipcRenderer.invoke('saveAiKey', key),
  getTriage: (prId) => ipcRenderer.invoke('getTriage', prId),
  getDigest: () => ipcRenderer.invoke('getDigest'),
  getReview: (prId) => ipcRenderer.invoke('getReview', prId)
}

contextBridge.exposeInMainWorld('api', api)
