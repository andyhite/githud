import { useEffect, useState, type ReactNode } from 'react'
import { ThemeProviderContext, type Theme } from './theme-context'

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  storageKey = 'githud-theme'
}: {
  children: ReactNode
  defaultTheme?: Theme
  storageKey?: string
}) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    if (theme === 'system') {
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.classList.add(sys)
      return
    }
    root.classList.add(theme)
  }, [theme])

  return (
    <ThemeProviderContext.Provider
      value={{
        theme,
        setTheme: (t) => {
          localStorage.setItem(storageKey, t)
          setThemeState(t)
        }
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}
