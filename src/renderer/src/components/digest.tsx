import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { api } from '../api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Digest({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.getDigest().then((d) => setText(d.markdown)).catch((e) => setError(String(e?.message ?? e)))
  }, [])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catch me up</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-muted-foreground">{error}</p>
        ) : text === null ? (
          <p className="text-muted-foreground">Thinking…</p>
        ) : (
          <div className="markdown max-h-[60vh] overflow-auto">
            <Markdown
              components={{
                // Open links in the OS browser via the gated IPC, not in-window.
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => { e.preventDefault(); if (href) api.openExternal(href) }}
                  >
                    {children}
                  </a>
                )
              }}
            >
              {text}
            </Markdown>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
