import { MoreVertical } from 'lucide-react'
import { PullRequest } from '@shared/types'
import { api } from '../api'
import { computeSnoozeUntil } from './snooze'
import { HideProps } from './hide-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export function RowActions({
  pr,
  isHidden,
  aiOn,
  onHide,
  onUnhide,
  onSnooze,
  onReview
}: { pr: PullRequest; isHidden: boolean; aiOn?: boolean; onReview?: (id: string) => void } & HideProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Row actions"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {aiOn && onReview && (
          <DropdownMenuItem onClick={() => onReview(pr.id)}>Draft review</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => api.copyToClipboard(pr.url)}>Copy PR link</DropdownMenuItem>
        {pr.branch && (
          <DropdownMenuItem onClick={() => api.copyToClipboard(pr.branch)}>Copy branch name</DropdownMenuItem>
        )}
        {onSnooze && (
          <>
            <DropdownMenuItem onClick={() => onSnooze(pr, computeSnoozeUntil(new Date(), '1h'))}>Snooze 1 hour</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(pr, computeSnoozeUntil(new Date(), 'tomorrow'))}>Snooze until tomorrow</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(pr, computeSnoozeUntil(new Date(), 'monday'))}>Snooze until Monday</DropdownMenuItem>
          </>
        )}
        {isHidden ? (
          <DropdownMenuItem onClick={() => onUnhide?.(pr.id)}>Unhide</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onHide?.(pr)}>Hide</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ShowHiddenToggle({
  count,
  open,
  onToggle
}: {
  count: number
  open: boolean
  onToggle: () => void
}) {
  if (count === 0) return null
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0 text-xs text-muted-foreground"
      onClick={onToggle}
    >
      {open ? 'hide hidden' : `show hidden (${count})`}
    </Button>
  )
}
