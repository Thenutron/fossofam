"use server";

import { db } from "@/db";
import { items, dinners, expenses, household, agentProposals, recipes, weekPlans, type WeekPlanDinner } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { routeStore, DEFAULT_DINNERS } from "@/lib/data";
import { revalidatePath } from "next/cache";

// ---- Items ----
export async function getItems() {
  return db.select().from(items).orderBy(items.createdAt);
}

export async function addItem(name: string, store: string | "auto") {
  const trimmed = name.trim();
  if (!trimmed) return;
  const s = store === "auto" || !store ? routeStore(trimmed) : store;
  await db.insert(items).values({ name: trimmed, store: s });
  revalidatePath("/");
}

export async function toggleItem(id: number, done: boolean) {
  await db.update(items).set({ done }).where(eq(items.id, id));
  revalidatePath("/");
}

export async function deleteItem(id: number) {
  await db.delete(items).where(eq(items.id, id));
  revalidatePath("/");
}

export async function clearCheckedItems() {
  await db.delete(items).where(eq(items.done, true));
  revalidatePath("/");
}

// Batch reassign items to a different store. Used by the overflow flow when
// the family didn't get everything at their anchor store and wants to roll
// the leftovers to the next stop. Resets done=false so they're shop-ready
// at the new store.
export async function reassignItems(ids: number[], store: string) {
  if (ids.length === 0) return;
  await db
    .update(items)
    .set({ store, done: false })
    .where(inArray(items.id, ids));
  revalidatePath("/");
}

// Batch delete — used by the overflow flow's "skip these" path.
export async function bulkDeleteItems(ids: number[]) {
  if (ids.length === 0) return;
  await db.delete(items).where(inArray(items.id, ids));
  revalidatePath("/");
}

// ---- Recipes (cache) ----
function canonicalMeal(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function getCachedRecipe(meal: string) {
  const c = canonicalMeal(meal);
  if (!c) return null;
  const rows = await db.select().from(recipes).where(eq(recipes.mealCanonical, c)).limit(1);
  return rows[0] ?? null;
}

export async function cacheRecipe(meal: string, kind: string | null, payload: unknown) {
  const c = canonicalMeal(meal);
  if (!c) return;
  await db
    .insert(recipes)
    .values({
      mealCanonical: c,
      mealName: meal.trim(),
      kind: kind ?? null,
      payload: payload as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: recipes.mealCanonical,
      set: {
        payload: payload as Record<string, unknown>,
        kind: kind ?? null,
        lastUsedAt: new Date(),
      },
    });
}

export async function bumpRecipeUsage(id: number) {
  await db
    .update(recipes)
    .set({ usedCount: sql`${recipes.usedCount} + 1`, lastUsedAt: new Date() })
    .where(eq(recipes.id, id));
}

// Updates an item's last-paid price. Pass null to clear.
// This is the per-item ledger that drives the shop-mode total AND seeds
// future budget estimates in the agent.
export async function updateItemCost(id: number, cost: number | null) {
  await db
    .update(items)
    .set({ cost, costAt: cost === null ? null : new Date() })
    .where(eq(items.id, id));
  revalidatePath("/");
}

// Apply a parsed-receipt diff in one shot: update cart-item prices, optionally
// add receipt-only items, and log a single expense at the receipt total.
// Items get marked done=true since the receipt is proof they were bought.
export async function applyReceipt(payload: {
  updates: { id: number; cost: number }[];
  adds: { name: string; store: string; cost: number }[];
  expense: { name: string; amount: number; kind: string };
}) {
  const now = new Date();
  for (const u of payload.updates) {
    await db
      .update(items)
      .set({ cost: u.cost, costAt: now, done: true })
      .where(eq(items.id, u.id));
  }
  for (const a of payload.adds) {
    const name = a.name.trim();
    if (!name) continue;
    await db.insert(items).values({
      name,
      store: a.store,
      cost: a.cost,
      costAt: now,
      done: true,
    });
  }
  const expName = payload.expense.name.trim() || "Shopping trip";
  await db.insert(expenses).values({
    name: expName,
    amount: payload.expense.amount || 0,
    kind: payload.expense.kind || "weekly",
  });
  revalidatePath("/");
}

// ---- Dinners ----
export async function getDinners() {
  const rows = await db.select().from(dinners).orderBy(dinners.sortOrder);
  if (rows.length === 0) {
    await db.insert(dinners).values(DEFAULT_DINNERS);
    return db.select().from(dinners).orderBy(dinners.sortOrder);
  }
  return rows;
}

export async function updateDinnerMeal(id: number, meal: string) {
  await db.update(dinners).set({ meal }).where(eq(dinners.id, id));
  revalidatePath("/");
}

// Update multiple fields of a single dinner slot at once. Used by the swap
// flow (which changes meal + tag + label) and any future per-slot editors.
export async function updateDinnerSlot(
  id: number,
  fields: { meal?: string; tag?: string; label?: string; note?: string },
) {
  await db.update(dinners).set(fields).where(eq(dinners.id, id));
  revalidatePath("/");
}

export async function setDinnerSkip(id: number, skip: boolean, skipReason: string) {
  await db.update(dinners).set({ skip, skipReason }).where(eq(dinners.id, id));
  revalidatePath("/");
}

// ---- Expenses ----
export async function getExpenses() {
  return db.select().from(expenses).orderBy(expenses.createdAt);
}

export async function addExpense(name: string, amount: number, kind: string) {
  const n = name.trim() || (kind === "bulk" ? "Bulk run" : "Expense");
  await db.insert(expenses).values({ name: n, amount: amount || 0, kind });
  revalidatePath("/");
}

export async function deleteExpense(id: number) {
  await db.delete(expenses).where(eq(expenses.id, id));
  revalidatePath("/");
}

// ---- Household state ----
export async function getHousehold() {
  const rows = await db.select().from(household).where(eq(household.id, 1));
  if (rows.length === 0) {
    await db.insert(household).values({ id: 1, currentWeek: 1, lastWeekTotal: null });
    return { id: 1, currentWeek: 1, lastWeekTotal: null, updatedAt: new Date() };
  }
  return rows[0];
}

export async function setCurrentWeek(week: number) {
  await db.update(household).set({ currentWeek: week, updatedAt: new Date() }).where(eq(household.id, 1));
  revalidatePath("/");
}

// Sunday of the calendar week AFTER today (server-side). Used to look up
// the next week's saved plan when the cycle rolls.
function nextSundayKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (7 - dow));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function closeOutWeek() {
  // snapshot weekly (non-bulk) total into lastWeekTotal, clear expenses,
  // un-skip days, advance the 1→2→3→1 cycle, AND promote any saved plan
  // for next week into the live dinners table so the family's planning
  // ahead actually activates when the week becomes current.
  const exp = await db.select().from(expenses);
  const weekly = exp.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
  const [hh] = await db.select().from(household).where(eq(household.id, 1));
  const cw = hh?.currentWeek ?? 1;
  const nextWeek = cw === 3 ? 1 : cw + 1;
  await db
    .update(household)
    .set({ lastWeekTotal: weekly, currentWeek: nextWeek, updatedAt: new Date() })
    .where(eq(household.id, 1));
  await db.delete(expenses);
  await db.update(dinners).set({ skip: false, skipReason: "" });

  // Promote next week's saved plan (if any) into the live rotation.
  try {
    const nextKey = nextSundayKey();
    const [nextPlan] = await db
      .select()
      .from(weekPlans)
      .where(eq(weekPlans.weekStart, nextKey))
      .limit(1);
    if (nextPlan) {
      const planDinners = nextPlan.dinners as WeekPlanDinner[];
      for (const pd of planDinners) {
        if (!pd?.day) continue;
        await db
          .update(dinners)
          .set({
            meal: pd.meal ?? "",
            tag: pd.tag ?? "cook",
            label: pd.label ?? "Real cook",
            note: pd.note ?? "",
            skip: !!pd.skip,
            skipReason: pd.skipReason ?? "",
          })
          .where(eq(dinners.day, pd.day));
      }
      // Plan is consumed — it's now the active rotation.
      await db.delete(weekPlans).where(eq(weekPlans.weekStart, nextKey));
    }
  } catch (e) {
    console.error("Failed to promote week plan on close-out:", e);
  }

  revalidatePath("/");
}

export async function clearLastWeek() {
  await db.update(household).set({ lastWeekTotal: null }).where(eq(household.id, 1));
  revalidatePath("/");
}

// ---- Week plans (future-week storage) ----
export async function getWeekPlan(weekStart: string) {
  const rows = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart)).limit(1);
  return rows[0] ?? null;
}

export async function saveWeekPlan(weekStart: string, planDinners: WeekPlanDinner[], notes: string = "") {
  await db
    .insert(weekPlans)
    .values({
      weekStart,
      dinners: planDinners as unknown as Record<string, unknown>[],
      notes,
    })
    .onConflictDoUpdate({
      target: weekPlans.weekStart,
      set: {
        dinners: planDinners as unknown as Record<string, unknown>[],
        notes,
        updatedAt: new Date(),
      },
    });
  revalidatePath("/");
}

export async function deleteWeekPlan(weekStart: string) {
  await db.delete(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  revalidatePath("/");
}

// ---- Bulk fetch for initial load ----
export async function getAllState() {
  const [i, d, e, h] = await Promise.all([getItems(), getDinners(), getExpenses(), getHousehold()]);
  return { items: i, dinners: d, expenses: e, household: h };
}

// ---- AI-proposed plan changes (apply after user accepts the preview) ----
type DinnerChange = {
  day: string;
  meal: string;
  tag: string;
  label: string;
  note: string;
  skip: boolean;
  skipReason: string;
};

type ShoppingAddition = {
  name: string;
  store: string;
};

export async function applyPlanChanges(
  dinnerChanges: DinnerChange[],
  shoppingAdditions: ShoppingAddition[],
  proposalId?: number,
) {
  for (const c of dinnerChanges) {
    await db
      .update(dinners)
      .set({
        meal: c.meal,
        tag: c.tag,
        label: c.label,
        note: c.note,
        skip: c.skip,
        skipReason: c.skipReason,
      })
      .where(eq(dinners.day, c.day));
  }
  for (const a of shoppingAdditions) {
    const trimmed = a.name.trim();
    if (!trimmed) continue;
    const store = a.store && a.store.length > 0 ? a.store : routeStore(trimmed);
    await db.insert(items).values({ name: trimmed, store });
  }
  if (proposalId !== undefined) {
    await db
      .update(agentProposals)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(agentProposals.id, proposalId));
  }
  revalidatePath("/");
}

export async function rejectProposal(proposalId: number) {
  await db
    .update(agentProposals)
    .set({ status: "rejected" })
    .where(eq(agentProposals.id, proposalId));
}

// Apply an imported recipe: write the meal/tag/label/note onto the chosen
// day's dinner slot and insert the shopping additions. The recipe steps go
// into the dinner's `note` field for now — when we add a `recipes` table
// later, this is the call site to change.
export async function applyImportedRecipe(
  day: string,
  payload: {
    title: string;
    tag: string;
    label: string;
    steps: string[];
    ingredients: { item: string; amount: string; note: string }[];
  },
  shoppingAdditions: { name: string; store: string }[],
  proposalId?: number,
) {
  const note = `Steps: ${payload.steps.join(" | ")}`.slice(0, 1500);
  await db
    .update(dinners)
    .set({ meal: payload.title, tag: payload.tag, label: payload.label, note })
    .where(eq(dinners.day, day));
  for (const a of shoppingAdditions) {
    const trimmed = a.name.trim();
    if (!trimmed) continue;
    const store = a.store && a.store.length > 0 ? a.store : routeStore(trimmed);
    await db.insert(items).values({ name: trimmed, store });
  }
  if (proposalId !== undefined) {
    await db
      .update(agentProposals)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(agentProposals.id, proposalId));
  }
  revalidatePath("/");
}
