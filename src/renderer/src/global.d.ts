import type { GithudApi } from '@shared/types'

declare global {
  interface Window {
    api: GithudApi
  }
}

export {}
