import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '@/components/ui/command'

export interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  return (
    <CommandDialog
      open={true}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No commands</CommandEmpty>
        <CommandGroup>
          {commands.map((c) => (
            <CommandItem
              key={c.id}
              onSelect={() => {
                c.run()
                onClose()
              }}
            >
              {c.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
