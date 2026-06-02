import type { GithudApi } from '@shared/types'

// A lazy proxy so every access reads the current window.api. In production the
// Electron preload sets window.api before the renderer loads; in tests, specs
// assign window.api in beforeEach (after this module is imported), and the proxy
// picks it up at call time.
export const api: GithudApi = new Proxy({} as GithudApi, {
  get(_target, prop: string) {
    return (window.api as unknown as Record<string, unknown>)[prop]
  }
})
