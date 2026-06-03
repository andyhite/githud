import { FeedEventKind } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  AtSign,
  CheckCircle2,
  Eye,
  GitMerge,
  MessageSquare,
  XCircle,
  type LucideIcon
} from 'lucide-react'

// Each feed-event kind maps to a lucide glyph. The shape conveys the kind of
// event; its *color* is set by severity at the row level, not here.
const KIND_ICON: Record<FeedEventKind, LucideIcon> = {
  approved: CheckCircle2,
  changes_requested: XCircle,
  review_commented: MessageSquare,
  comment: MessageSquare,
  mention: AtSign,
  ci_failed: XCircle,
  ci_succeeded: CheckCircle2,
  ci_regressed: XCircle,
  review_requested: Eye,
  review_re_requested: Eye,
  changes_addressed: CheckCircle2,
  merged: GitMerge,
  closed: XCircle
}

export function EventIcon({ kind, className }: { kind: FeedEventKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return <Icon className={cn('h-4 w-4', className)} aria-hidden="true" />
}
