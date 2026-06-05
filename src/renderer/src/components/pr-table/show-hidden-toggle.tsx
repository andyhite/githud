import { Button } from '@/components/ui/button'

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
