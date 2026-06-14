# CONTEXT.md — Fosso Family Meal Planner & Budgeting

> This document captures the full context behind the Fosso Meal Planner build so any
> developer or AI agent (e.g. Claude Code) can continue the work without re-interviewing
> the family. It is the source of truth for *why* things are the way they are.

---

## 1. What this is

A shared, synced **weekly meal planner + grocery router + budget tracker** for the Fosso
family (two adults: Knute & Kait, plus two young girls). It started as a single-file HTML
artifact and was rebuilt as a deployable Next.js app (see `HANDOFF.md` and `DEPLOY.md`).

The family's stated long-term intent: this is likely **the first module of a broader
"family tracking and budgeting AI agent."** Build with that in mind — clean data model,
extensible, not a one-off.

---

## 2. The family profile (use this for all defaults & personalization)

### Dietary
- **Gluten-free household.** Sometimes dairy-free too (especially the adults) — treat DF as
  optional/per-meal, not absolute.
- **The two girls are NOT GF/DF-restricted** — they eat normal food, just want it healthy.
- **They love potatoes** — potato-forward meals are a feature, not filler.
- **Always buy organic** where it matters (protein especially). Pasture-raised eggs (pricey).
- **Clean-eating, no-plastic, low-waste, glass-packaging-preferring** family. This is a values
  thing, not just a preference — respect it in product suggestions.

### Favorite foods (seed meal ideas & staples from these)
- Potatoes (all forms), chuck roast in the crock pot, German potatoes (vinegar, onion, beans,
  hot dogs), beans & bacon, burger bowls + fries, **loaded nachos (ground beef, shredded
  cheese, good-quality refried beans)**.
- Coconut milk (must-have), raw milk, tuna/mackerel tins.
- Fruit: **watermelon, cara cara oranges, organic honeycrisp, bananas (lots — cheap, nightly
  "book + banana" ritual with the girls), oranges, seasonal fruit.**
- Drinks: Zevia, Olipop (nice-to-have, not essential).
- Girls' breakfast: **Dutch baby ~1×/week**, otherwise boiled eggs, oatmeal, yogurt.
- Girls love grilled cheese; they're small eaters (two girls can split one Goodles mac box).

### Per-person meal patterns
- **Knute (lunch/breakfast):** high-protein only — protein powder + yogurt, mackerel/tuna tin,
  or dinner leftovers.
- **Kait (lunch):** fresh or leftovers — GF/DF tuna plate or turkey roll-ups (no bread or GF wrap).
- **Girls:** grilled cheese, ½ Goodles mac box, half-sandwiches, banana + book at night.

### Baking
- They bake occasionally, often tied to **Thursday Bible study** (they host weekly) or as their
  own treats. Dutch apple pie, cookies, etc. Snacks + decaf coffee for study nights are cheapest
  at Grocery Outlet. Baking does **double duty** (study + family treats) — they like to "kill two
  birds with one stone." This efficiency mindset runs through everything.

### Chickens
- They have chickens but **won't lay eggs until August 2026.** Until then they buy pricey
  pasture-raised organic eggs. They buy **organic chicken feed from Coastal roughly monthly.**
- Post-August logic: the egg line drops from the budget and roughly offsets the feed cost
  (~a wash). The app encodes this in the 3-week cycle.

---

## 3. Budget & shopping constraints (core domain logic)

- **Weekly grocery target: ~$215/week.**
- **Plus a bulk/Costco trip every 3 weeks for ~$200.** Tracked as a SEPARATE envelope so it
  doesn't make a normal week look blown.
- **Coastal chicken feed** (~monthly) is folded into the cycle (parked on Week 2).
- Other one-offs come up: family/church potlucks, parties, meals for others. They like to plan
  for these and combine errands.

### The 3-week rhythm (encoded in `lib/data.ts` → WEEKS)
- **Week 1:** normal lean week ($215). Bible study.
- **Week 2:** $215 + Coastal feed run. Bible study.
- **Week 3:** $215 + ~$200 Costco/bulk. Bible study.
- Rationale: spread big trips so they never gang up on one week.

---

## 4. Stores (the routing knowledge — this is real, hard-won family knowledge)

Encoded in `lib/data.ts` → `STORE`, `STORE_ORDER`, `ROUTE_PLAN`, `routeStore()`.

| Store | Role | Notes |
|---|---|---|
| **Fred Meyer** | Default weekly run / catch-all | Good for pickup, some sales. Not cheapest. Reliable. |
| **Grocery Outlet** | Deals + snacks + decaf + baking | Great prices but **inconsistent stock** — can't count on it. Whatever's missing rolls to Fred Meyer. MyShan milk here (not raw, but better) = fallback milk. |
| **Co-op** | Raw milk source | Worth the trip for the real thing. |
| **Raw milk pickup** | Kait's spot | 2 gallons @ $10 each. Stock-up, not weekly. |
| **Sprouts** (Mill Creek) | Mold-free coffee + organic | Far south drive, **very expensive**. Kait batches it on south trips. |
| **Costco** | Bulk only (Week 3) | Membership TBD in August. Feels like it always costs more than they'd like. |
| **Trader Joe's** | Flowers + event needs | Farther away. Nice when an event/flowers come up. |
| **Coastal** | Organic chicken feed (~monthly) | Will become part of grocery budget once eggs stop being bought. |
| **Online** | Coffee backup, glass/pantry restocks | Mold-free coffee can be ordered online. |

### Routing logic philosophy
- "Start at Grocery Outlet (cheapest), grab what's there, anything missing rolls to Fred Meyer."
- Suggested store ORDER with a **spend target per stop** and an **item-count/avg-per-item** so
  they can pace themselves to hit ~$215.
- `routeStore(name)` keyword-matches an item to its best store. Mold-free coffee → Sprouts,
  decaf/snacks/baking → Grocery Outlet, raw milk → Co-op, feed → Coastal, paper towels/drinks/
  bulk → Costco, flowers → TJ, glass/online → Online, default → Fred Meyer.

---

## 5. The "mold-free coffee" detail
Kait specifically buys **mold-free coffee** from Sprouts or online. This is a real product
category (brands market "mold-free"/"tested" coffee). It's a recurring, somewhat pricey buy.
The app routes it to Sprouts or Online. Decaf for Bible study is separate and cheap (Grocery Outlet).

---

## 6. Product decisions made during the build

These were explicit choices — don't silently reverse them.

1. **Artifact → real app.** The single-file HTML artifact (great for design iteration) was
   abandoned as the *product* because it doesn't persist and can't be shared between two phones.
   A meal planner that forgets everything every session dies in week two. **Persistence + sync
   was identified as the make-or-break requirement.**
2. **Two-person, shared.** Both Knute and Kait shop. The tool MUST let either person add to one
   synced list from their own phone. This is why it's a hosted app, not a local file.
3. **Hosting: Vercel (Hobby/free) + Neon Postgres (free, native Vercel Marketplace integration).**
   Family chose Neon over Supabase (they asked specifically). Neon is Vercel's native default
   since Vercel Postgres was retired (Dec 2024). One-click install injects `DATABASE_URL`.
4. **Access model: shared & open** (anyone with the URL). They keep the URL private. A password
   or real logins can be added later (noted as future work).
5. **ORM: Drizzle** (type-safe, cleaner to maintain as this grows into a bigger agent).
6. **Recipes & online orders: clipboard handoff, not in-app AI calls.** To keep it 100% free,
   the 📖 recipe and "Draft order" buttons copy a tailored, family-context-loaded prompt to the
   clipboard to paste into Claude. **Future upgrade:** a real `/api/recipe` route using the
   Anthropic API for true in-app generation (requires an API key + per-use cost).
7. **Effort tiers matter.** "Lazy" was explicitly redefined to mean **<5 min prep, minimal
   dishes** — peeling potatoes (German potatoes) is NOT lazy, it's "medium." Three tiers: lazy /
   medium / crock pot. The swap button only pulls from genuinely-lazy meals.
8. **Skip-a-day** is required: leftovers, invited out, date night, potluck → mark a dinner
   skipped so no groceries/cooking are assumed.
9. **Encouraging tone on budget.** Last week's total shows with positive reinforcement when at/
   under $215 (never guilt when over — "fresh start this week").

---

## 7. Honest assessment given to the family (keep this candor)

The family explicitly asked "will this actually work, or get tried once and abandoned?" The
honest answer given: the original artifact would NOT survive past week two because (a) it forgot
everything on close, (b) it couldn't be shared between two phones, (c) the dinner plan was
generated, not theirs, and (d) budget tracking competed with their bank app. The rebuild solves
a–b structurally. **c and d are still open** and depend on family input:
- They need to supply their **real 10–15 dinner rotation** (currently seeded with reasonable
  guesses).
- **Store spend targets are estimates** — need real receipts to tune `ROUTE_PLAN`.

A tool only survives if it does something the bank app doesn't (custom week vs. $215, warns
before a bulk week) and feels like *theirs*. Design future work around stickiness, not features.

---

## 8. Data model (current)

Tables (Drizzle, Postgres) — see `db/schema.ts`:
- **`household`** — singleton row (id=1): `currentWeek` (1–3), `lastWeekTotal`. Shared cycle/
  budget state.
- **`items`** — shopping/out-of list: `name`, `store` (routed key), `done`, `createdAt`.
- **`dinners`** — 7 slots: `day`, `tag` (crock/lazy/cook/left/flex), `label`, `meal`, `note`,
  `skip`, `skipReason`, `sortOrder`.
- **`expenses`** — logged grocery runs: `name`, `amount`, `kind` (weekly|bulk), `createdAt`.

All domain constants (stores, routing, staples, idea banks, default dinners, the 3-week cycle,
weekly target) live in **`lib/data.ts`** — the single place to customize.

---

## 9. The bigger vision (where this is headed)

The family signaled this is **one module of a family tracking + budgeting AI agent.** Likely
future modules (not built yet — see HANDOFF for suggested roadmap):
- Broader household budgeting beyond groceries (bills, categories, monthly view).
- Chore/task tracking, calendar, kids' schedules.
- The chicken/egg economics is a hint they think in **household systems** — model accordingly.
- An actual **agent** layer: proactive suggestions ("you're trending over budget," "Costco week
  is coming, here's the consolidated list," "you have leftovers — skip a dinner").
- Recipe generation, meal-from-pantry, "what can I make with what's about to expire" (low-waste
  is a core value).

Build the meal/grocery module so its data model and patterns generalize to these.
