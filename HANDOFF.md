# HANDOFF.md — for Claude Code

> Read `CONTEXT.md` first — it's the family profile and the *why* behind every decision.
> This file is the *what now*: current state of the codebase, conventions, and the roadmap
> toward the broader "family tracking & budgeting AI agent."

---

## TL;DR for the agent picking this up

You're inheriting a **working, builds-clean Next.js 15 app**: a shared meal planner + grocery
router + weekly budget tracker for the Fosso family. It deploys free on **Vercel + Neon Postgres**
with **Drizzle ORM**. The family wants this to grow into a larger household agent. Extend it;
don't rewrite it. Keep it free, keep it shared/synced, keep it *theirs*.

**Verify before you start:**
```bash
npm install
DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build   # should compile clean
```
(The build doesn't connect to the DB; a dummy URL is fine for compile-checking.)

---

## Current state — what's DONE and working

- ✅ Next.js 15 App Router, React 19, TypeScript, plain CSS (light/dark via CSS vars).
- ✅ Drizzle schema + Neon connection (`db/`), migration generated in `drizzle/`.
- ✅ Server actions for all CRUD (`app/actions.ts`) with `revalidatePath`.
- ✅ Full UI ported to React (`components/Planner.tsx`) — optimistic updates via `useTransition`.
- ✅ Six tabs: Dashboard, Dinner rotation, Out of/need, Shop & budget, Store route, 3-week cycle.
- ✅ All domain logic centralized in `lib/data.ts`.
- ✅ Deploy guide (`DEPLOY.md`), README, `.env.example`, `.gitignore`, seed script.
- ✅ Production build passes with zero TS/build errors.

### Feature inventory (so you don't break anything)
- **Dashboard:** "Week of {date}", where-to-go-next (first routed store), tomorrow's dinner
  (skip-aware), quick out-of entry + 10 staple quick-adds, what-to-get-by-store, online-order
  CTA, budget metrics + bar, last-week encouragement banner, quick add-expense.
- **Dinners:** 7 editable slots, skip-a-day (with reason prompt), 📖 recipe (clipboard handoff),
  three-tier idea bank (lazy <5min / medium / crock), baking ideas, everyone-else meals reference.
- **Out of/need:** add w/ auto-routing or manual store, check/delete, staples grid.
- **Shop & budget:** per-run expense logging (weekly|bulk), store-by-store checklist,
  close-out-week (snapshots to lastWeekTotal, clears expenses, un-skips dinners).
- **Store route:** ordered stops, spend targets, per-item avg, fallback ("if missing → X"),
  cheat-sheet.
- **3-week cycle:** tap a week to set `currentWeek`; budget envelopes follow.

---

## Conventions — follow these

1. **All domain data lives in `lib/data.ts`.** Stores, routing regex, staples, idea banks,
   default dinners, the WEEKS cycle, WEEKLY_TARGET. If you're hardcoding a grocery/store fact
   anywhere else, you're doing it wrong.
2. **All DB access goes through server actions in `app/actions.ts`.** No client-side DB calls.
   Each mutating action calls `revalidatePath("/")`.
3. **Optimistic UI pattern:** client updates local state immediately, then
   `startTransition(() => serverAction(...))`. Match this when adding features so the app feels
   instant. (Note the `routeStoreClient` mirror in `Planner.tsx` — keep it in sync with
   `routeStore` in `lib/data.ts`, or better, refactor both to import one shared function.)
4. **Money:** always `Math.round()` displayed dollars. Weekly target = `WEEKLY_TARGET` (215).
   Bulk is a SEPARATE envelope — never fold bulk into the weekly $215 total.
5. **Tone:** encouraging, never guilt. Respect the family's values (organic, no-plastic, glass,
   low-waste) in any product/store suggestions.
6. **Styling:** CSS variables in `globals.css`, sentence case, two font weights (400/500), no
   heavy bolding, Tabler icons (already linked in `layout.tsx`). Keep light/dark parity.
7. **Free-first.** Don't introduce paid services without flagging cost. The recipe/order
   clipboard handoff exists specifically to avoid API costs.

---

## Known gaps / immediate next steps (low-hanging, high-value)

1. **Real dinner rotation.** `DEFAULT_DINNERS` in `lib/data.ts` is seeded with guesses. Ask the
   family for their actual 10–15 repeat meals and replace. This is the #1 stickiness lever.
2. **Tune store spend targets.** `ROUTE_PLAN` targets ($60 Grocery Outlet, $110 Fred Meyer, etc.)
   are estimates. After a couple real shops, update with actual receipt data.
3. **De-dupe the routing function.** `routeStore` (lib) and `routeStoreClient` (Planner.tsx) are
   duplicated. Extract to one isomorphic function imported by both.
4. **Concurrency refresh.** Two phones editing simultaneously won't see each other's changes until
   a refresh (server actions + revalidate, no live subscription). For true real-time, add polling
   (simple: refetch every N seconds when tab is focused) or Neon's LISTEN/NOTIFY / a lightweight
   websocket. Polling is the cheap, good-enough first step.
5. **Optional auth.** Currently shared/open by design. If they want light protection, a single
   shared-password gate (middleware + cookie) is the least-friction option.

---

## Roadmap toward the "family tracking & budgeting AI agent"

The family explicitly framed this as **module one of a bigger agent.** Suggested arc, built to
generalize the existing patterns:

### Phase 2 — Real-time +真 stickiness
- Live sync (polling or push) so both phones stay current.
- Push/notification nudges: "Costco week starts Sunday — here's the consolidated list,"
  "you're trending $30 over with 3 days left," "you have roast leftovers — want to skip a dinner?"
- Pantry / "what's about to expire" (serves the low-waste value): add an optional `pantry` table;
  suggest meals from what's on hand.

### Phase 3 — Broader household budget
- Generalize `expenses` beyond groceries: add `category` (groceries, bills, kids, feed, eating-out,
  gifts…) and a monthly view. The $215 weekly is one budget among several.
- Recurring items (feed monthly, bulk every 3 weeks) → a `recurring`/`schedule` concept so the
  agent can anticipate spend. The 3-week cycle is a hardcoded prototype of this; make it data-driven.
- Income/savings goals if they want full budgeting.

### Phase 4 — The agent layer
- An `/api/agent` endpoint (Anthropic API) that reads household state and proactively suggests:
  meal plans from preferences + budget, consolidated shopping by store, "kill two birds" errand
  batching (a stated family value), and budget coaching.
- In-app recipe generation (`/api/recipe`) replacing the clipboard handoff once they're OK with
  an API key + small cost. Family context (GF/DF, potatoes, organic, portion sizes) is already
  assembled in `recipePrompt()` in `Planner.tsx` — reuse it server-side.
- Meal-from-pantry, leftover-aware planning, seasonal-fruit awareness (cara cara/honeycrisp in
  season → suggest them).

### Phase 5 — Other modules (household systems)
- Chores/tasks, shared calendar, kids' schedules, the chicken/egg economics as a tracked
  "homestead" sub-budget. The family thinks in systems (the egg→feed offset is evidence) — model
  the household as composable budgets + schedules + a preferences profile the agent reads.

### Data-model guidance for scaling
- Keep a single **household preferences** source (dietary, values, favorites, per-person patterns)
  that every module + the agent reads. Right now that knowledge lives in `CONTEXT.md` and
  `lib/data.ts`; as it grows, promote it to a `preferences` table or a typed config the agent
  consumes. This is what makes personalization consistent across modules.
- Favor additive schema changes; the existing tables are clean to extend.

---

## Gotchas

- **Neon scale-to-zero:** first request after idle adds ~1s. Harmless here; don't "fix" it by
  keeping compute always-on (costs money).
- **Vercel Hobby = personal use only.** No ads, not for sale. A family tool is fine.
- **`dynamic = "force-dynamic"`** on the home page is intentional (always fresh from DB). Keep it
  unless you add caching deliberately.
- **First load auto-seeds** dinners + household row (see `getDinners`/`getHousehold`). `db:seed`
  is optional/idempotent.
- Don't commit `.env*.local` or `next-env.d.ts` (gitignored).

---

## File map (quick reference)

```
CONTEXT.md            ← family profile + decisions (read first)
HANDOFF.md            ← this file
DEPLOY.md             ← click-by-click Vercel + Neon setup
README.md             ← overview + local dev
app/
  actions.ts          ← ALL server actions (DB reads/writes)
  page.tsx            ← loads state → <Planner>
  layout.tsx          ← root + Tabler icons
  globals.css         ← all styles
components/
  Planner.tsx         ← full client UI (all 6 tabs)
db/
  schema.ts           ← Drizzle tables
  index.ts            ← Neon connection
  seed.ts             ← optional seed
lib/
  data.ts             ← stores, routing, staples, ideas, dinners, cycle ← CUSTOMIZE HERE
drizzle/              ← generated migration SQL
```

---

## Definition of "don't break this"
The app must remain: **free to run, shared between two phones, persistent, and feel like the
Fosso family's own tool.** Every feature is in service of *not getting abandoned in week two.*
Prioritize stickiness (their real meals, real numbers, proactive help) over feature count.
