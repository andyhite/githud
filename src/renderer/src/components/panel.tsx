import type { ReactNode } from 'react'
import { Chip } from './chip'
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
      <header className="z-10 flex items-center gap-2 border-b bg-card px-3 py-2.5 lg:sticky lg:top-0">
        <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
        {count !== undefined && <Chip tone="count">{count}</Chip>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      {/* Below lg the body grows with its content (no internal scroll — the page
          scrolls); at lg it scrolls internally. No scrollbar-gutter reservation, so
          the scrollbar sits flush against the panel edge for tables and blank slates
          alike. @container = inline-size container (drives PrTable's width-based
          column hiding at every size). At lg the body also has a definite height, so
          we upgrade it to a *size* container — that's what lets the blank slate's
          tall-* (container-height) variants resolve. (Width queries still work under
          size containment, so column hiding is unaffected.) */}
      <div className={cn('@container flex min-h-0 flex-1 flex-col overflow-visible lg:overflow-y-auto lg:[container-type:size]', flush ? 'px-0 py-1' : 'px-3 py-2')}>
        {children}
      </div>
    </section>
  )
}
