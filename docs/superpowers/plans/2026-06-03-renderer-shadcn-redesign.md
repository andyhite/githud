# Renderer shadcn + recharts Refactor/Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the githud renderer presentation layer on Tailwind v4 + shadcn/ui (Zinc base, light+dark) and recharts, made DRY via shared `Panel`/`PrTable`/`Chip` components and orchestration hooks — with zero functional change.

**Architecture:** Presentation-only rewrite against the fixed `DashboardSnapshot`/`window.api` seam. `src/shared/**` and `src/main/**` are untouched, as is every pure renderer helper and its test (`sort-prs`, `snooze`, `match`, `pr-status`, `trend-metrics`, `team-filter`, `selection`, `activity-severity`). The hand-rolled `styles.css` and the bespoke primitives/charts are replaced by shadcn components, CSS-variable design tokens, and recharts.

**Tech Stack:** React 19, TypeScript, electron-vite, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (Radix + cva + clsx + tailwind-merge), lucide-react, recharts, Vitest + React Testing Library.

---

## Conventions for this plan

This codebase **TDDs pure logic, not glue** (see CLAUDE.md). All the pure helpers
already have passing tests and are **not modified** — they are the regression
net. The renderer components are glue; they are verified by **`pnpm run
typecheck` + `pnpm run build` + existing component tests + a manual smoke pass**,
not by writing new failing tests first. So most tasks below verify with
typecheck/build/test gates rather than a red-green-refactor cycle. The one place
we write/adjust tests is the existing component test suite (Task 17), kept
role/text-based.

**Standing rule for every task:** the app must still launch (`pnpm run dev`) and
`pnpm run typecheck` must pass at each commit. Run `pnpm test` whenever a task
touches a file that has a test. Never edit anything under `src/shared/` or
`src/main/`.

**Reference — files that must NOT change:** `src/shared/**`, `src/main/**`,
`src/renderer/src/components/{sort-prs,snooze,match,pr-status,trend-metrics,team-filter,activity-severity}.ts`,
`src/renderer/src/hooks/selection.ts`, and their `.test.ts` files. (`trend-metrics`
stays; only `chart-geometry` is removed.)

---

## Task 1: Install Tailwind v4 + shadcn toolchain and wire build aliases

**Files:**
- Modify: `package.json` (deps — via pnpm add)
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts` alias entry (verify/modify — see step 4)
- Create: `src/renderer/src/lib/utils.ts`
- Create: `src/renderer/src/styles/tailwind.css`
- Modify: `src/renderer/src/main.tsx`

- [ ] **Step 1: Install dependencies**

```bash
pnpm add tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react recharts
```

Expected: all resolve; `recharts` and `tailwindcss` appear in `dependencies`.

- [ ] **Step 2: Add the Tailwind Vite plugin and the `@` alias to the renderer target**

Edit `electron.vite.config.ts`. Add the import and update only the `renderer`
block (leave `main`/`preload` exactly as they are):

```ts
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    plugins: [react(), tailwindcss()]
  }
})
```

> Critical: the `@` alias goes on the **renderer** target only (the documented
> per-target-alias footgun). shadcn components import from `@/components/ui/...`.

- [ ] **Step 3: Add the `@` path to tsconfig**

Edit `tsconfig.json` `compilerOptions.paths`:

```json
"paths": {
  "@shared/*": ["src/shared/*"],
  "@/*": ["src/renderer/src/*"]
}
```

- [ ] **Step 4: Ensure Vitest resolves `@`**

Open `vitest.config.ts`. Add a `resolve.alias` entry mapping `@` →
`src/renderer/src` (next to the existing `@shared` alias) so component tests can
import shadcn components. Example shape:

```ts
import { resolve } from 'path'
// inside defineConfig({ ... test, resolve: { alias: {
//   '@shared': resolve(__dirname, 'src/shared'),
//   '@': resolve(__dirname, 'src/renderer/src'),
// } } })
```

If `vitest.config.ts` has no `resolve.alias` yet, add one; match the file's
existing style.

- [ ] **Step 5: Create the shadcn `cn` helper**

Create `src/renderer/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 6: Create the Tailwind entry + design tokens (Zinc base + semantic tokens, light & dark)**

Create `src/renderer/src/styles/tailwind.css`:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

/* Zinc neutral base + githud semantic tokens. Light and dark both defined so
   the theme toggle preserves all color-coding. Semantic tokens carry MEANING
   (severity / CI / status / triage) and are the single source of those colors. */
:root {
  --radius: 0.5rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.141 0.005 285.823);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --accent-foreground: oklch(0.21 0.006 285.885);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.92 0.004 286.32);
  --input: oklch(0.92 0.004 286.32);
  --ring: oklch(0.705 0.015 286.067);

  /* githud semantic palette (light) */
  --sev-info: oklch(0.55 0.18 256);
  --sev-success: oklch(0.62 0.17 150);
  --sev-failure: oklch(0.58 0.22 27);
  --sev-mention: oklch(0.68 0.14 75);
}

.dark {
  --background: oklch(0.141 0.005 285.823);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.21 0.006 285.885);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.21 0.006 285.885);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.92 0.004 286.32);
  --primary-foreground: oklch(0.21 0.006 285.885);
  --secondary: oklch(0.274 0.006 286.033);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.274 0.006 286.033);
  --muted-foreground: oklch(0.705 0.015 286.067);
  --accent: oklch(0.274 0.006 286.033);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.552 0.016 285.938);

  /* githud semantic palette (dark) — mirrors the old GitHub-dark hues */
  --sev-info: oklch(0.72 0.15 250);     /* ~#58a6ff */
  --sev-success: oklch(0.75 0.18 150);  /* ~#3fb950 */
  --sev-failure: oklch(0.68 0.21 25);   /* ~#f85149 */
  --sev-mention: oklch(0.78 0.13 80);   /* ~#d29922 */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-sev-info: var(--sev-info);
  --color-sev-success: var(--sev-success);
  --color-sev-failure: var(--sev-failure);
  --color-sev-mention: var(--sev-mention);

  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}

* { box-sizing: border-box; }
body { margin: 0; }
```

> Note: these are the standard shadcn Zinc token values. The four `--sev-*`
> tokens are githud-specific and map to the old GitHub-dark severity hues
> (blue/green/red/amber) used by activity severity, CI checks, status tags, and
> triage chips.

- [ ] **Step 7: Swap the stylesheet import in main.tsx and wrap in ThemeProvider (placeholder import added in Task 2)**

For now, only change the CSS import so Tailwind loads. Edit `src/renderer/src/main.tsx`:

```ts
import './styles/tailwind.css'
```

(Remove `import './styles.css'`. Do NOT delete `styles.css` yet — components
still reference its classes until migrated; it is removed in Task 18. Both
stylesheets can coexist meanwhile.)

Re-add the styles.css import temporarily so the un-migrated components keep their
styling during migration:

```ts
import './styles/tailwind.css'
import './styles.css'
```

- [ ] **Step 8: Verify**

Run: `pnpm run typecheck`
Expected: PASS.
Run: `pnpm run build`
Expected: builds all three targets with no alias/plugin errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build(renderer): add Tailwind v4 + shadcn toolchain, @ alias, design tokens"
```

---

## Task 2: Initialize shadcn and add the component set + ThemeProvider

**Files:**
- Create: `components.json`
- Create: `src/renderer/src/components/ui/*` (generated)
- Create: `src/renderer/src/components/theme-provider.tsx`
- Modify: `src/renderer/src/main.tsx`

- [ ] **Step 1: Create `components.json`** (so the shadcn CLI targets the renderer dirs)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/src/styles/tailwind.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 2: Add the component set via the shadcn CLI**

```bash
pnpm dlx shadcn@latest add button card badge dialog dropdown-menu table switch slider toggle-group tabs select input label command sheet tooltip scroll-area separator chart
```

Expected: files land in `src/renderer/src/components/ui/`. If the CLI prompts
about the CSS/aliases, accept the `components.json` values. `chart` pulls in
recharts wiring (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`).

- [ ] **Step 3: Create the ThemeProvider** (shadcn Vite dark-mode pattern, localStorage-backed)

Create `src/renderer/src/components/theme-provider.tsx`:

```tsx
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'system'
type ThemeProviderState = { theme: Theme; setTheme: (t: Theme) => void }

const initial: ThemeProviderState = { theme: 'system', setTheme: () => null }
const ThemeProviderContext = createContext<ThemeProviderState>(initial)

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  storageKey = 'githud-theme'
}: {
  children: React.ReactNode
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
      value={{ theme, setTheme: (t) => { localStorage.setItem(storageKey, t); setThemeState(t) } }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeProviderContext)
  if (ctx === undefined) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
```

> `defaultTheme = 'dark'` preserves today's dark-only behavior on first launch.

- [ ] **Step 4: Mount ThemeProvider + add the app background classes in main.tsx**

Edit `src/renderer/src/main.tsx` to wrap `<App />`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ThemeProvider } from './components/theme-provider'
import './styles/tailwind.css'
import './styles.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="githud-theme">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
)
```

Also add base color classes to `<body>` in `src/renderer/index.html`:

```html
<body class="bg-background text-foreground antialiased">
```

- [ ] **Step 5: Verify**

Run: `pnpm run typecheck` → PASS.
Run: `pnpm run dev`, confirm the window still renders the existing UI on a dark
background (old styles.css still applies; Tailwind base now active).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): init shadcn component set + ThemeProvider"
```

---

## Task 3: Shared `Chip` primitive (status / triage / severity / count)

Replaces the `.triage-*`, `.status-tag`/`.st-*`, `.count`, `.reviewer-chip`, and
`.label-chip` CSS families with one `cva` component driven by the semantic tokens.

**Files:**
- Create: `src/renderer/src/components/Chip.tsx`

- [ ] **Step 1: Implement `Chip`**

```tsx
import { cva, type VariantProps } from 'class-variance-authority'
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
}: VariantProps<typeof chip> & { className?: string; title?: string; children: React.ReactNode }) {
  return <span className={cn(chip({ tone }), className)} title={title}>{children}</span>
}
```

> Tone mapping the re-skins will use: triage `quick_approve`→success,
> `careful_read`→info, `likely_changes`→mention, `big_effort`→`info` with a
> distinct class if needed (purple isn't a semantic token; use `text-sev-info`
> plus a violet utility, or add a `--sev-effort` token if you want exact parity —
> add it to both `:root`/`.dark` and `@theme inline` if so). Status tags map by
> the existing `statusTag()` logic: red→failure, amber→mention, green→success,
> blue→info, muted→neutral.

- [ ] **Step 2: Verify**

Run: `pnpm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Chip.tsx
git commit -m "feat(renderer): shared Chip primitive over semantic tokens"
```

---

## Task 4: Shared `Panel` component

Collapses the four duplicated panel headers in `App.tsx` (heading + count badge +
spacer + header actions + scroll body + loading/empty handling) into one shell.

**Files:**
- Create: `src/renderer/src/components/Panel.tsx`

- [ ] **Step 1: Implement `Panel`**

```tsx
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
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
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
```

- [ ] **Step 2: Verify** — `pnpm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Panel.tsx
git commit -m "feat(renderer): shared Panel shell"
```

---

## Task 5: Re-skin shared PR cells + unify into one `PrTable`

Collapses `NeedsReviewTable` and `MyPullRequestsTable` into a single configurable
table. **Behavior must be identical** — same columns per panel, same hidden-row
handling, same empty-state rules, same selection highlight.

**Files:**
- Create: `src/renderer/src/components/pr-cells.tsx` (move the shared cell
  components out of `NeedsReviewTable.tsx`)
- Create: `src/renderer/src/components/PrTable.tsx`
- Modify (later removed): `NeedsReviewTable.tsx`, `MyPullRequestsTable.tsx`

- [ ] **Step 1: Move shared cells into `pr-cells.tsx`**

Move these from `NeedsReviewTable.tsx` verbatim in logic, re-skinned to
Tailwind + `Chip`: `checksMeta`, `AgeCell`, `relativeAge`, `ReviewersCell`,
`stackedBase`, `DiffStat`, `statusTag`, `StatusCell`, `PrTitleCell`,
`TRIAGE_META`, `TriageChip`. Keep the exact triage/status mapping logic; only
swap presentation. Examples:

```tsx
export function DiffStat({ pr }: { pr: PullRequest }) {
  return (
    <span className="tabular-nums whitespace-nowrap text-xs"
      title={`${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'} changed`}>
      <span className="text-sev-success">+{pr.additions}</span>{' '}
      <span className="text-sev-failure">−{pr.deletions}</span>
    </span>
  )
}

export function StatusCell({ pr }: { pr: PullRequest }) {
  const { tone, label } = statusTag(pr) // statusTag returns { tone: ChipTone, label }
  return <Chip tone={tone}>{label}</Chip>
}
```

Rewrite `statusTag`/`TRIAGE_META` to return a `ChipTone` instead of a CSS class
string (red→`failure`, amber→`mention`, green→`success`, blue→`info`,
muted→`neutral`). `ReviewersCell` renders `Chip tone="info"` per reviewer.
`PrTitleCell` keeps the title button (→ `api.openExternal`) + meta line; use
`text-card-foreground`/`text-muted-foreground` and `hover:underline`.

- [ ] **Step 2: Implement `PrTable` with a column config**

```tsx
import { PullRequest, TriageVerdict } from '@shared/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AgeCell, PrTitleCell, ReviewersCell, DiffStat, StatusCell, TriageChip } from './pr-cells'
import { RowActions } from './RowActions'
import { EmptyState } from './EmptyState'
import { cn } from '@/lib/utils'
import { HideProps } from './hide-types'

export type PrColumn = 'diff' | 'status' | 'triage' | 'reviewers' | 'age'

export function PrTable({
  items, columns, hiddenIds = [], showHidden = false, showAuthor = false,
  emptyVariant, selectedId, loading, verdicts, aiOn, onReview,
  onHide, onUnhide, onSnooze
}: {
  items: PullRequest[]
  columns: PrColumn[]
  showAuthor?: boolean
  emptyVariant: 'review' | 'mine' | 'team'
  selectedId?: string
  loading?: boolean
  showHidden?: boolean
  verdicts?: Record<string, TriageVerdict>
  aiOn?: boolean
  onReview?: (id: string) => void
} & HideProps) {
  const hiddenSet = new Set(hiddenIds)
  const visible = items.filter((p) => !hiddenSet.has(p.id))
  const hidden = items.filter((p) => hiddenSet.has(p.id))

  if (loading && items.length === 0) return <p className="px-0.5 py-2 text-muted-foreground">Loading…</p>
  if (visible.length === 0 && !(showHidden && hidden.length > 0)) return <EmptyState variant={emptyVariant} />

  const headFor: Record<PrColumn, string> = {
    diff: 'Diff', status: 'Status', triage: 'Triage', reviewers: 'Waiting on', age: 'Age'
  }
  const cellFor = (c: PrColumn, pr: PullRequest) => {
    switch (c) {
      case 'diff': return <DiffStat pr={pr} />
      case 'status': return <StatusCell pr={pr} />
      case 'triage': return <TriageChip verdict={verdicts?.[pr.id]} />
      case 'reviewers': return <ReviewersCell pr={pr} />
      case 'age': return <AgeCell pr={pr} />
    }
  }
  const compact = (c: PrColumn) => c !== 'reviewers'

  const row = (pr: PullRequest, isHidden: boolean) => (
    <TableRow key={pr.id}
      className={cn('group', isHidden && 'opacity-50', pr.id === selectedId && 'bg-sev-info/15')}>
      <TableCell><PrTitleCell pr={pr} showAuthor={showAuthor} /></TableCell>
      {columns.map((c) => (
        <TableCell key={c} className={cn('align-top', compact(c) && 'w-px whitespace-nowrap')}>
          {cellFor(c, pr)}
        </TableCell>
      ))}
      <TableCell className="w-px whitespace-nowrap text-right">
        <RowActions pr={pr} isHidden={isHidden} aiOn={aiOn}
          onHide={onHide} onUnhide={onUnhide} onSnooze={onSnooze} onReview={onReview} />
      </TableCell>
    </TableRow>
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PR</TableHead>
          {columns.map((c) => <TableHead key={c} className={cn(compact(c) && 'w-px whitespace-nowrap')}>{headFor[c]}</TableHead>)}
          <TableHead aria-hidden="true" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((pr) => row(pr, false))}
        {showHidden && hidden.map((pr) => row(pr, true))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 3: Extract `HideProps` to its own module**

Create `src/renderer/src/components/hide-types.ts`:

```ts
import { PullRequest } from '@shared/types'

export interface HideProps {
  hiddenIds?: string[]
  onHide?: (pr: PullRequest) => void
  onUnhide?: (id: string) => void
  onSnooze?: (pr: PullRequest, until: string) => void
}
```

- [ ] **Step 4: Verify** — `pnpm run typecheck` → PASS (RowActions arrives next task; if it errors, finish Task 6 then re-run).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/{pr-cells.tsx,PrTable.tsx,hide-types.ts}
git commit -m "feat(renderer): unify PR tables into configurable PrTable + shared cells"
```

---

## Task 6: `RowActions` on shadcn DropdownMenu

Replaces the hand-rolled outside-click/Esc kebab menu. Same menu items and same
handlers (pre-review, copy PR link, copy branch, snooze 1h/tomorrow/Monday,
hide/unhide).

**Files:**
- Create: `src/renderer/src/components/RowActions.tsx`

- [ ] **Step 1: Implement** with `DropdownMenu` + `lucide-react` `MoreVertical`:

```tsx
import { MoreVertical } from 'lucide-react'
import { PullRequest } from '@shared/types'
import { api } from '../api'
import { computeSnoozeUntil } from './snooze'
import { HideProps } from './hide-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export function RowActions({
  pr, isHidden, aiOn, onHide, onUnhide, onSnooze, onReview
}: { pr: PullRequest; isHidden: boolean; aiOn?: boolean; onReview?: (id: string) => void } & HideProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Row actions"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {!isHidden && aiOn && onReview && (
          <DropdownMenuItem onClick={() => onReview(pr.id)}>Pre-review (AI)</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => api.copyToClipboard(pr.url)}>Copy PR link</DropdownMenuItem>
        {pr.branch && <DropdownMenuItem onClick={() => api.copyToClipboard(pr.branch)}>Copy branch name</DropdownMenuItem>}
        {!isHidden && onSnooze && (
          <>
            <DropdownMenuItem onClick={() => onSnooze(pr, computeSnoozeUntil(new Date(), '1h'))}>Snooze 1 hour</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(pr, computeSnoozeUntil(new Date(), 'tomorrow'))}>Snooze until tomorrow</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(pr, computeSnoozeUntil(new Date(), 'monday'))}>Snooze until Monday</DropdownMenuItem>
          </>
        )}
        {isHidden
          ? <DropdownMenuItem onClick={() => onUnhide?.(pr.id)}>Unhide</DropdownMenuItem>
          : <DropdownMenuItem onClick={() => onHide?.(pr)}>Hide</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

> The `opacity-0 group-hover:opacity-100` on the trigger reproduces the
> hover-reveal; the `group` class lives on the `TableRow` (Task 5). The hidden
> row keeps actions visible because Task 5 doesn't add `opacity-0` there — verify
> revealed/hidden rows still show the kebab; if not, force visible when
> `isHidden` with `opacity-100`.

- [ ] **Step 2: Add `ShowHiddenToggle`** to the same file (small link-style button):

```tsx
import { Button } from '@/components/ui/button'

export function ShowHiddenToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  if (count === 0) return null
  return (
    <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={onToggle}>
      {open ? 'hide hidden' : `show hidden (${count})`}
    </Button>
  )
}
```

- [ ] **Step 3: Verify** — `pnpm run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/RowActions.tsx
git commit -m "feat(renderer): RowActions on shadcn DropdownMenu"
```

---

## Task 7: `EmptyState` + lucide icon map

**Files:**
- Modify: `src/renderer/src/components/EmptyState.tsx`
- Modify/Create: `src/renderer/src/components/icons.tsx`

- [ ] **Step 1: Re-skin `EmptyState`** to Tailwind, keeping the three variants
  (`review` celebratory, `mine`, `team`, `activity` neutral) and their copy. Use
  a `lucide-react` icon (e.g. `CheckCircle2` for `review`, `Inbox` otherwise) in a
  rounded badge. Center it; keep the celebratory green tint via `text-sev-success`
  on the `review` variant. Preserve the exact title/subtitle strings currently in
  the file so existing tests still match.

- [ ] **Step 2: Rebuild the `KIND_ICON` map in `icons.tsx`** using `lucide-react`,
  keeping it an **exhaustive** `Record<FeedEventKind, ...>` (typecheck enforces
  this — see CLAUDE.md). Map each kind to a sensible lucide icon (e.g.
  review→`Eye`, comment→`MessageSquare`, ci_failure→`XCircle`,
  ci_success→`CheckCircle2`, merged→`GitMerge`, etc.). Keep the export name/shape
  `ActivityFeed` imports.

- [ ] **Step 3: Verify** — `pnpm run typecheck` (the exhaustive map must compile) → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/{EmptyState.tsx,icons.tsx}
git commit -m "feat(renderer): EmptyState + lucide icon map"
```

---

## Task 8: `ActivityFeed` re-skin

Keep structure: severity left-accent border + colored icon + actor / action /
subject / time, unread tint, click-to-read. Drive colors from `--sev-*` tokens
via `activity-severity.ts` (unchanged) instead of the `.sev-*` CSS rules.

**Files:**
- Modify: `src/renderer/src/components/ActivityFeed.tsx`

- [ ] **Step 1: Re-skin** — map the severity (`info|failure|success|mention`) to
  border/icon/bg classes:

```tsx
const SEV = {
  info: { border: 'border-l-sev-info', icon: 'text-sev-info', unread: 'bg-sev-info/10', hover: 'hover:bg-sev-info/20' },
  failure: { border: 'border-l-sev-failure', icon: 'text-sev-failure', unread: 'bg-sev-failure/10', hover: 'hover:bg-sev-failure/20' },
  success: { border: 'border-l-sev-success', icon: 'text-sev-success', unread: 'bg-sev-success/10', hover: 'hover:bg-sev-success/20' },
  mention: { border: 'border-l-sev-mention', icon: 'text-sev-mention', unread: 'bg-sev-mention/10', hover: 'hover:bg-sev-mention/20' }
} as const
```

Each row: `flex gap-2 w-full text-left rounded-md border border-l-[3px] bg-background p-2`
plus the severity classes (and `unread` bg only when `e.unread`). Keep the
`onRead(e.id)` click and the actor/action/title/ctx/time layout. Preserve text
content/structure so `ActivityFeed.test.tsx` keeps passing (update only class
assertions if any).

- [ ] **Step 2: Verify** — `pnpm run typecheck` → PASS; `pnpm test -- ActivityFeed` (update class-based assertions if it fails on markup).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ActivityFeed.tsx
git commit -m "feat(renderer): re-skin ActivityFeed on severity tokens"
```

---

## Task 9: TrendStrip charts on recharts (delete chart-geometry)

**Files:**
- Create: `src/renderer/src/components/TrendChart.tsx`
- Modify: `src/renderer/src/components/TrendStrip.tsx`
- Delete: `src/renderer/src/components/Sparkline.tsx`, `MiniBars.tsx`,
  `chart-geometry.ts`, `chart-geometry.test.ts`

- [ ] **Step 1: Create `TrendChart`** — one axis-less micro-chart, line or bars,
  using recharts directly (the cards are tiny; full `ChartContainer` is optional):

```tsx
import { Line, LineChart, Bar, BarChart, ResponsiveContainer } from 'recharts'

export function TrendChart({ values, viz, color }: { values: number[]; viz: 'line' | 'bars'; color: string }) {
  const data = values.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={28}>
      {viz === 'line' ? (
        <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      ) : (
        <BarChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Bar dataKey="v" fill={color} radius={1} isAnimationActive={false} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Update `TrendStrip`** — replace `<Sparkline>`/`<MiniBars>` with
  `<TrendChart>`, and change the card `color` values from CSS-var strings to token
  color values recharts can consume. Use literal hex/oklch via
  `getComputedStyle` is overkill — instead pass concrete colors mapped to the
  tokens, e.g. `color="var(--sev-info)"` works for recharts `stroke`/`fill` since
  they accept any CSS color string. Re-skin the cards/labels/values/deltas to
  Tailwind (`rounded-lg border bg-card p-2`, delta up→`text-sev-success`,
  down→`text-sev-failure`, flat→`text-muted-foreground`). Keep the collapse
  toggle and the `collecting…` empty state. **`trend-metrics.ts` is not touched.**

- [ ] **Step 3: Delete the old chart files**

```bash
git rm src/renderer/src/components/Sparkline.tsx \
       src/renderer/src/components/MiniBars.tsx \
       src/renderer/src/components/chart-geometry.ts \
       src/renderer/src/components/chart-geometry.test.ts
```

- [ ] **Step 4: Verify** — `pnpm run typecheck` → PASS; `pnpm test -- trend` (trend-metrics suite stays green; TrendStrip.test updated for new markup in Task 17 if needed); `pnpm run dev` shows the strip rendering.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(renderer): TrendStrip charts on recharts, drop hand-rolled SVG"
```

---

## Task 10: TopBar re-skin + theme toggle

**Files:**
- Modify: `src/renderer/src/components/TopBar.tsx`

- [ ] **Step 1: Re-skin** the bar (brand, the consolidated connection/freshness
  status text, the refresh button with its next-interval label, the settings
  button) using `Button` (`variant="ghost"`/`"outline"`) and lucide icons
  (`RefreshCw`, `Settings`). Keep all existing status logic
  (`updated Nm ago`/`stale`/`offline`/`rate limited`, amber throttle on the
  interval) — only swap presentation. Use `text-muted-foreground` for status,
  `text-sev-mention` for the throttled interval.

- [ ] **Step 2: Add a theme toggle** (Sun/Moon lucide via `useTheme`) as a ghost
  icon button in the bar:

```tsx
import { useTheme } from './theme-provider'
import { Sun, Moon } from 'lucide-react'
// const { theme, setTheme } = useTheme()
// <Button variant="ghost" size="icon" aria-label="Toggle theme"
//   onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
//   {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
// </Button>
```

- [ ] **Step 3: Verify** — `pnpm run typecheck` → PASS; `pnpm run dev`: toggling
  the button flips light/dark and the choice persists across reload.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TopBar.tsx
git commit -m "feat(renderer): re-skin TopBar + add theme toggle"
```

---

## Task 11: Settings on shadcn Dialog + Tabs + inputs

Rebuild the Settings modal on `Dialog`, with the section nav as vertical `Tabs`
(or a button rail), and the bespoke inputs swapped to shadcn equivalents. **All
fields, persistence, validation, and the saveToken/saveAiKey flows are
unchanged** — same `api.*` calls, same field set (token, AI key, notify kinds,
quiet hours, refresh interval, API budget, team labels, team orgs, charts
collapse, test-notification).

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`
- Delete (after migration): `src/renderer/src/components/inputs.tsx`
- Create: `src/renderer/src/components/ChipInput.tsx` (the one bespoke input with
  no direct shadcn analog)

- [ ] **Step 1: Move `ChipInput`** out of `inputs.tsx` into its own
  `ChipInput.tsx`, re-skinned with Tailwind + shadcn `Badge` for the chips and
  `Input` for the draft field. Keep its exact add-on-Enter/comma/blur,
  remove-on-Backspace, dedupe behavior and the `aria-label={`Remove ${v}`}`.

- [ ] **Step 2: Rebuild `Settings`** using:
  - `Dialog`/`DialogContent` for the overlay (replaces `.settings-overlay`/`-panel`)
  - vertical `Tabs` (`TabsList`/`TabsTrigger`/`TabsContent`) for the section nav
  - `Switch` for toggles (replaces `Toggle`)
  - `Slider` for the API-budget/interval sliders (replaces `Slider`)
  - `ToggleGroup` (type single) for the segmented interval presets (replaces `Segmented`)
  - `Select` for any dropdowns
  - shadcn `Input`/`Label` for text/number/password fields and quiet-hours times
  - notify-kind checkboxes: shadcn `Checkbox` in the existing 2-col grid
  - `ChipInput` for team labels/orgs
  - the test-notification button as `Button variant="outline"`

  Preserve every label string and every `api` call. Keep the
  `chartsCollapsed` stale-write caveat behavior as-is (no regression expected).

- [ ] **Step 3: Add the Appearance section** — a theme control in Settings using
  `useTheme`: a `ToggleGroup` of Light / Dark / System (writes via `setTheme`).
  This is the settings home of the toggle added to TopBar in Task 10.

- [ ] **Step 4: Delete `inputs.tsx`**

```bash
git rm src/renderer/src/components/inputs.tsx
```

- [ ] **Step 5: Verify** — `pnpm run typecheck` → PASS; `pnpm test -- Settings`
  (update queries to the new markup, keep role/label-based — `getByRole('switch')`,
  `getByLabelText`, `getByRole('button', { name: /save/i })`); `pnpm run dev`:
  open settings, confirm every field reads/writes and Save persists.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): rebuild Settings on shadcn Dialog/Tabs/inputs + Appearance"
```

---

## Task 12: CommandPalette on shadcn Command

**Files:**
- Modify: `src/renderer/src/components/CommandPalette.tsx`

- [ ] **Step 1: Rebuild** using `CommandDialog` + `CommandInput`/`CommandList`/
  `CommandItem` (cmdk under the hood). Keep the same `Command[]` prop shape
  (`{ id, label, run }`), the same commands, and the `onClose` behavior. ⌘K open
  state stays owned by `App.tsx` (Task 16) — this component just renders open and
  reports close. Preserve fuzzy filtering (cmdk provides it; the existing
  `match.ts` may become unused here — if so leave it, it's still used elsewhere;
  do not delete shared helpers without checking references).

- [ ] **Step 2: Verify** — `pnpm run typecheck` → PASS; `pnpm run dev`: ⌘K opens,
  filtering + selection runs the command + closes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/CommandPalette.tsx
git commit -m "feat(renderer): CommandPalette on shadcn Command"
```

---

## Task 13: Digest, DigestPane, ReviewPanel re-skin

**Files:**
- Modify: `src/renderer/src/components/Digest.tsx`, `DigestPane.tsx`, `ReviewPanel.tsx`

- [ ] **Step 1: `Digest`** (catch-me-up modal) → shadcn `Dialog`; keep the
  `react-markdown` render of the digest body, styled with Tailwind typography
  utilities (replace `.markdown-body` rules: `prose`-like via explicit utility
  classes on headings/links/code, or a small `markdown` className kept in
  tailwind.css). Keep loading/error states and `onClose`.

- [ ] **Step 2: `DigestPane`** (brief delta, in the rail) → re-skin the editorial
  pull-quote (`.digest-quote`) with Tailwind: keep the serif italic bold look via
  `font-serif italic font-bold text-2xl leading-snug`. Keep the empty fallback.

- [ ] **Step 3: `ReviewPanel`** (AI first-pass) → shadcn `Dialog` or `Sheet`;
  keep the finding list with severity left-border (blocker→`border-l-sev-failure`,
  concern→`border-l-sev-mention`, note→`border-l-sev-info`), summary, and
  loading/error. Keep `onClose` and the `prId` prop.

- [ ] **Step 4: Verify** — `pnpm run typecheck` → PASS; `pnpm test -- DigestPane`
  (update markup queries); `pnpm run dev` (if an AI key is configured) smoke the
  digest + review modals.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/{Digest.tsx,DigestPane.tsx,ReviewPanel.tsx}
git commit -m "feat(renderer): re-skin Digest/DigestPane/ReviewPanel on shadcn"
```

---

## Task 14: TokenSetup re-skin

**Files:**
- Modify: `src/renderer/src/components/TokenSetup.tsx`

- [ ] **Step 1: Re-skin** the first-run token screen on shadcn `Card` + `Input` +
  `Button`, keeping the exact copy, the validation/`saveToken` flow, the error
  message rendering, and the external help link (routed through
  `api.openExternal`). Keep `onSaved(login)`.

- [ ] **Step 2: Verify** — `pnpm run typecheck` → PASS; `pnpm test -- TokenSetup`
  (update markup queries, keep role/label-based); `pnpm run dev` first-run smoke.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/TokenSetup.tsx
git commit -m "feat(renderer): re-skin TokenSetup on shadcn Card/Input"
```

---

## Task 15: Migrate the panels in App.tsx to Panel + PrTable

Wire the new shared components into the dashboard. **Same panels, same props,
same order** (Needs-review, Team [conditional on `teamLabels`], Mine, Recap [AI],
Activity).

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Delete (after this task): `NeedsReviewTable.tsx`, `MyPullRequestsTable.tsx`

- [ ] **Step 1: Replace each `<div className="panel"><h2>…</h2>…</div>` block**
  with `<Panel title count actions>` containing a `<PrTable>` (or `ActivityFeed`/
  `DigestPane`). Column configs:
  - Needs-review: `columns={aiOn ? ['diff','status','triage','age'] : ['diff','status','age']}`, `emptyVariant="review"`, `showAuthor`, passes `verdicts`/`aiOn`/`onReview`/`selectedId`.
  - Team: `columns={['diff','status','age']}`, `emptyVariant="team"`, `showAuthor`, label-filter chips in `actions`.
  - Mine: `columns={['diff','status','reviewers','age']}`, `emptyVariant="mine"`.
  - The `actions` slot carries `ShowHiddenToggle` (+ `LabelFilterChips` for Team, + the recap/activity link buttons).

- [ ] **Step 2: Re-skin `LabelFilterChips`** (Team header) to use `Chip`
  (active→`tone="info"`, muted→`tone="neutral"` with `line-through opacity-70`).
  Keep the toggle behavior + transient `mutedLabels` state in App.

- [ ] **Step 3: Replace the `<main className="layout">` / `.tables` / `.rail`
  grid** with Tailwind: `grid grid-cols-[2fr_1fr] gap-3 p-3 flex-1 overflow-hidden`,
  the tables column `flex flex-col gap-3 min-h-0`, the rail likewise. Each
  scrolling `Panel` already handles its own overflow.

- [ ] **Step 4: Delete the old table components**

```bash
git rm src/renderer/src/components/NeedsReviewTable.tsx \
       src/renderer/src/components/MyPullRequestsTable.tsx
```

> `ShowHiddenToggle` moved to `RowActions.tsx` in Task 6 — update the import in
> `App.tsx` accordingly.

- [ ] **Step 5: Verify** — `pnpm run typecheck` → PASS; `pnpm test -- PrTables`
  (rename/retarget this suite to `PrTable`; keep role/text queries); `pnpm run dev`:
  all panels render with correct columns, hide/unhide/snooze/show-hidden work,
  team label chips filter, selection highlight + j/k still work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): dashboard panels on shared Panel + PrTable"
```

---

## Task 16: Extract orchestration hooks; thin App.tsx

Pull the state tangle out of `App.tsx` into focused hooks with **identical
behavior** (same handlers, relocated).

**Files:**
- Create: `src/renderer/src/hooks/useHideActions.ts`
- Create: `src/renderer/src/hooks/useTriageVerdicts.ts`
- Create: `src/renderer/src/hooks/useKeyboardNav.ts`
- Create: `src/renderer/src/hooks/useReadState.ts`
- Create: `src/renderer/src/hooks/useSettings.ts` (load settings + chartsCollapsed toggle)
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: `useHideActions(qc)`** — returns `{ onHide, onUnhide, onSnooze }`,
  each doing the existing `api.*().then(applySnapshot)` where `applySnapshot`
  sets `['dashboard']` query data. Move verbatim from App.

- [ ] **Step 2: `useReadState(qc)`** — returns `{ onRead, onReadAll }` using
  `api.markRead/markAllRead().then(applyEvents)`. Move verbatim.

- [ ] **Step 3: `useTriageVerdicts(aiOn, visibleReview)`** — owns the
  `verdicts` state + the `useRef<Set>` request guard + the effect that lazily
  fetches `api.getTriage(pr.id)` once per session. Returns `verdicts`. Move verbatim.

- [ ] **Step 4: `useKeyboardNav({ visibleReview, selected, setSelected, onHide, openPalette })`**
  — the `keydown` effect (j/k via `moveSelection`, Enter→openExternal, e→hide,
  ⌘/Ctrl-K→openPalette; ignores INPUT/TEXTAREA). Move verbatim. Keep `selection.ts` as-is.

- [ ] **Step 5: `useSettings()`** — loads settings via `api.getSettings()`,
  exposes `settings` + `onToggleCharts` (the optimistic `saveSettings`). Move verbatim.

- [ ] **Step 6: Refactor `App.tsx`** to consume the hooks; it becomes thin
  composition. No behavior change. Keep the auth gate, the `loading` derivation,
  the `aiOn`/`showDigest`/`reviewId`/`paletteOpen` local state, the commands array.

- [ ] **Step 7: Verify** — `pnpm run typecheck` → PASS; `pnpm test` (full) → green;
  `pnpm run dev`: exercise hide/snooze/mark-read/mark-all/⌘K/j-k-Enter-e/triage
  load/digest — all behave as before.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(renderer): extract orchestration hooks, thin App.tsx"
```

---

## Task 17: Update component tests to the new markup

**Files:**
- Modify: `src/renderer/src/components/{PrTables→PrTable,Settings,ActivityFeed,DigestPane,TrendStrip,TokenSetup}.test.tsx`

- [ ] **Step 1: Run the full suite and triage failures**

Run: `pnpm test`
Expected: pure-logic suites green; some component suites fail on changed markup/classes.

- [ ] **Step 2: Fix each failing component test** — keep tests **role/text/label
  based** (the resilient style): `getByRole('switch'|'button'|'menuitem')`,
  `getByLabelText`, `findByText`. Open menus via `getByRole('button', { name:
  /row actions/i })` then click a `role="menuitem"` (shadcn `DropdownMenuItem`
  renders `role="menuitem"`). Remove assertions on old CSS class names; assert on
  visible text/roles/state instead. Update the `window.api` mocks in `beforeEach`
  as before.

- [ ] **Step 3: Verify**

Run: `pnpm test`
Expected: ALL green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(renderer): update component tests to shadcn markup"
```

---

## Task 18: Delete styles.css + dead code; final verification

**Files:**
- Delete: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/main.tsx` (drop the styles.css import)
- Sweep: any remaining references to removed files/classes

- [ ] **Step 1: Remove the legacy stylesheet import** from `main.tsx` (leave only
  `import './styles/tailwind.css'`).

- [ ] **Step 2: Delete `styles.css`**

```bash
git rm src/renderer/src/styles.css
```

- [ ] **Step 3: Grep for orphans**

Run: `grep -rn "className=\"\(panel\|pr-table\|top-bar\|settings-\|trend-\|activity-item\|toggle\|segmented\|chip-input\|triage-chip\|status-tag\|empty-state\)" src/renderer/src || echo "clean"`
Expected: `clean` (no leftover old class names). Fix any stragglers.

Run: `grep -rn "chart-geometry\|Sparkline\|MiniBars\|NeedsReviewTable\|MyPullRequestsTable\|inputs'" src/renderer/src || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Full verification gate**

Run: `pnpm run typecheck` → PASS
Run: `pnpm test` → ALL PASS
Run: `pnpm run build` → builds all three targets clean

- [ ] **Step 5: Manual smoke pass** (`pnpm run dev`) — checklist:
  - First-run token screen (if no token) reads/saves.
  - All panels render: needs-review (with/without AI triage column), team (when
    labels configured), mine, recap (AI), activity.
  - Hide / unhide / snooze / show-hidden across panels.
  - Team label chips filter; selection + j/k/Enter/e; ⌘K palette.
  - Settings: every field reads/writes/saves; notify kinds; quiet hours; sliders;
    interval presets; team labels/orgs; test notification; Appearance toggle.
  - Theme toggle (TopBar + Settings) flips light/dark and persists across reload.
  - Trend strip renders + collapses; "collecting…" when no history.
  - Top-bar status text + refresh interval (amber when throttled).
  - Catch-me-up digest + delta digest pane + AI pre-review (if AI key set).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(renderer): remove legacy styles.css + dead components"
```

---

## Self-review notes (coverage map)

- Stack/infra/aliases → Task 1; shadcn init + ThemeProvider → Task 2.
- Theme tokens (Zinc + semantic, light+dark) → Task 1; toggle → Tasks 2/10/11.
- Shared layer: `Chip`→3, `Panel`→4, `PrTable`+cells→5, `RowActions`→6.
- Component mapping: EmptyState/icons→7, ActivityFeed→8, TopBar→10, Settings/
  inputs→11, CommandPalette→12, Digest/DigestPane/ReviewPanel→13, TokenSetup→14,
  LabelFilterChips→15.
- Charts (recharts) + delete chart-geometry → Task 9.
- App.tsx tidy / hooks → Tasks 15–16.
- Testing → Task 17; delete styles.css + dead files + final gate → Task 18.
- Guardrails (no shared/main edits, pure helpers untouched) → stated up top and
  honored throughout (theme is localStorage, not Settings).
