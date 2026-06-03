import type { ReactNode } from 'react'
import { Chip } from './Chip'
import { cn } from '@/lib/utils'

export function Panel({
  title,
  count,
  actions,
  className,
  children
}: {
  title: string
  count?: number
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card', className)}>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-3 py-2.5">
        <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
        {count !== undefined && <Chip tone="count">{count}</Chip>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
    </section>
  )
}
