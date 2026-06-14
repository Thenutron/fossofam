# CLAUDE.md

Project guidance for Claude Code working in this repo.

## Start here
1. Read **`CONTEXT.md`** — the Fosso family profile, dietary needs, store knowledge, budget
   constraints, and every product decision + its rationale.
2. Read **`HANDOFF.md`** — current codebase state, conventions, gotchas, and the roadmap toward
   the broader "family tracking & budgeting AI agent" this is the first module of.

## What this is
A shared, synced weekly **meal planner + grocery router + budget tracker** for the Fosso family.
Next.js 15 (App Router) + Drizzle ORM + Neon Postgres, deployed free on Vercel. Intended to grow
into a larger household agent.

## Verify the build before/after changes
```bash
npm install
DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build   # must compile clean
```

## Hard rules (full detail in HANDOFF.md)
- **Domain data → `lib/data.ts` only** (stores, routing, staples, idea banks, dinners, cycle, target).
- **DB access → server actions in `app/actions.ts` only**; each mutation calls `revalidatePath("/")`.
- **Optimistic UI:** update local state, then `startTransition(() => action())`.
- **Money:** round displayed dollars; weekly target is `WEEKLY_TARGET` (215); **bulk is a separate
  envelope**, never folded into the weekly total.
- **Keep it free** (no paid services without flagging cost), **shared/synced**, and **persistent**.
- **Tone:** encouraging, never guilt. Honor family values: organic, no-plastic, glass, low-waste.
- **Styling:** CSS variables in `globals.css`, sentence case, weights 400/500 only, Tabler icons,
  light/dark parity.

## The prime directive
Every change should serve **stickiness** — the family's real meals, real receipt numbers, and
proactive help — so this tool doesn't get abandoned in week two. Extend; don't rewrite.
