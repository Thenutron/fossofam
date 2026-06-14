# Fosso Meal Planner

A shared, synced weekly meal planner + grocery router for the Fosso family. Built with Next.js + Drizzle + Neon Postgres, deployable free on Vercel.

**→ See [DEPLOY.md](./DEPLOY.md) for full setup instructions.**

## Features

- **Dashboard** — "Week of" date, where to go next, tomorrow's dinner, quick out-of entry, budget at a glance, quick add-expense, last-week encouragement
- **Dinner rotation** — 7 editable slots, skip-a-day, 📖 recipe generation, three-tier idea bank (lazy / medium / crock), baking ideas
- **Out of / need** — running shopping list with auto-routing to the cheapest sensible store
- **Shop & budget** — store-by-store checklist, per-run expense logging, $215 weekly target tracking, close-out-week
- **Store route** — suggested store order with spend targets + fallback logic
- **3-week cycle** — Costco bulk + Coastal feed spread across weeks so they don't gang up

## Stack

- Next.js 15 (App Router, Server Actions)
- Drizzle ORM
- Neon Serverless Postgres
- Plain CSS (no build-step styling), light/dark mode

## Local development

```bash
npm install
cp .env.example .env.local   # add your Neon DATABASE_URL
npm run db:push              # create tables
npm run dev                  # http://localhost:3000
```

## Project structure

```
app/
  actions.ts      server actions (all DB reads/writes)
  page.tsx        loads state, renders Planner
  layout.tsx      root layout + Tabler icons
  globals.css     all styles
components/
  Planner.tsx     full client UI (dashboard + all tabs)
db/
  schema.ts       Drizzle table definitions
  index.ts        Neon connection
  seed.ts         optional seed script
lib/
  data.ts         stores, routing, staples, idea banks, dinners — edit these to customize
```

## Customizing

Most things you'll want to tweak live in `lib/data.ts`: store spend targets (`ROUTE_PLAN`), the default dinners, staples, idea banks, and the weekly target. Edit and redeploy.
