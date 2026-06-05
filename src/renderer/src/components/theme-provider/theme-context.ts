import { createContext } from 'react'

export type Theme = 'dark' | 'light' | 'system'
export type ThemeProviderState = { theme: Theme; setTheme: (t: Theme) => void }

export const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)
