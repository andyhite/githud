import type { ReactNode } from 'react'
import { Chip } from './Chip'
import { cn } from '@/lib/utils'

export function Panel({
  title,
  count,
  actions,
  className,
  flush = false,
  children
}: {
  title: string
  count?: number
  actions?: ReactNode
  className?: string
  // flush: drop the body's horizontal padding so edge-to-edge content (the PR
  // tables) sits near the panel edge; cell padding still provides a small inset.
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card', className)}>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-3 py-2.5">
        <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
        {count !== undefined && <Chip tone="count">{count}</Chip>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]', flush ? 'px-0 py-1' : 'px-3 py-2')}>
        {children}
      </div>
    </section>
  )
}
