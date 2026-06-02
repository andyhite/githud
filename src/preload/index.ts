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
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
