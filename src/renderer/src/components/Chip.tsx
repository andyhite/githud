import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const chip = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        info: 'bg-sev-info/15 text-sev-info',
        success: 'bg-sev-success/15 text-sev-success',
        failure: 'bg-sev-failure/15 text-sev-failure',
        mention: 'bg-sev-mention/15 text-sev-mention',
        effort: 'bg-sev-effort/15 text-sev-effort',
        count: 'bg-secondary text-secondary-foreground'
      }
    },
    defaultVariants: { tone: 'neutral' }
  }
)

export type ChipTone = NonNullable<VariantProps<typeof chip>['tone']>

export function Chip({
  tone,
  className,
  title,
  children
}: VariantProps<typeof chip> & { className?: string; title?: string; children: ReactNode }) {
  return (
    <span className={cn(chip({ tone }), className)} title={title}>
      {children}
    </span>
  )
}
