import type { GithudApi } from '@shared/types'

declare global {
  interface Window {
    api: GithudApi
    platform: string // NodeJS process.platform, exposed by preload ('darwin' | 'win32' | …)
  }
}

export {}
