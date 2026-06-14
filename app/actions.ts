"use server";

import { db } from "@/db";
import { items, dinners, expenses, household } from "@/db/schema";
import { eq } from "drizzle-orm";
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

export async function closeOutWeek() {
  // snapshot weekly (non-bulk) total into lastWeekTotal, clear expenses, un-skip days
  const exp = await db.select().from(expenses);
  const weekly = exp.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
  await db.update(household).set({ lastWeekTotal: weekly, updatedAt: new Date() }).where(eq(household.id, 1));
  await db.delete(expenses);
  await db.update(dinners).set({ skip: false, skipReason: "" });
  revalidatePath("/");
}

export async function clearLastWeek() {
  await db.update(household).set({ lastWeekTotal: null }).where(eq(household.id, 1));
  revalidatePath("/");
}

// ---- Bulk fetch for initial load ----
export async function getAllState() {
  const [i, d, e, h] = await Promise.all([getItems(), getDinners(), getExpenses(), getHousehold()]);
  return { items: i, dinners: d, expenses: e, household: h };
}
