"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import type { Item, Dinner, Expense, Household } from "@/db/schema";
import {
  STORE, STORE_ORDER, ROUTE_PLAN, STAPLES, WEEKLY_TARGET, WEEKS,
  LAZY_IDEAS, MEDIUM_IDEAS, CROCK_IDEAS,
  routeStore, routeArea, AREA, AREAS,
} from "@/lib/data";
import {
  addItem, toggleItem, deleteItem, clearCheckedItems, updateItemCost,
  reassignItems, bulkDeleteItems,
  updateDinnerMeal, updateDinnerSlot, setDinnerSkip,
  addExpense, deleteExpense, setCurrentWeek, closeOutWeek, clearLastWeek,
  getAllState, applyPlanChanges, rejectProposal, applyImportedRecipe,
  applyReceipt, cacheRecipe,
} from "@/app/actions";

type Props = {
  initialItems: Item[];
  initialDinners: Dinner[];
  initialExpenses: Expense[];
  initialHousehold: Household;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SKIP_REASONS = [
  "Ate out",
  "Family's house",
  "Leftovers",
  "Date night",
  "Don't feel like it",
  "Potluck",
];

const SWAP_OPTIONS: { tag: string; label: string; tier: string; ideas: readonly string[] }[] = [
  { tag: "lazy",  label: "Lazy",      tier: "Lazy",       ideas: LAZY_IDEAS },
  { tag: "cook",  label: "Real cook", tier: "Real cook",  ideas: MEDIUM_IDEAS },
  { tag: "crock", label: "Crock pot", tier: "Crock pot",  ideas: CROCK_IDEAS },
];

function weekOfLabel() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  return monday.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function datesForCurrentWeek(now: Date = new Date()): Record<string, Date> {
  const day = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day);
  sunday.setHours(0, 0, 0, 0);
  const out: Record<string, Date> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    out[DAY_NAMES[i]] = d;
  }
  return out;
}

function isSameYMD(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Sunday of the calendar week containing `date`, offset by N full weeks.
function sundayOfWeek(date: Date, weekOffset: number = 0): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + weekOffset * 7);
  return d;
}

function weekRangeLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const s = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${s} – ${e}`;
}

// Cycle is 1→2→3→1. Given the user's current cycle position, what cycle
// position is N weeks ahead?
function cyclePosFor(currentCyclePos: number, weeksAhead: number): number {
  return ((currentCyclePos - 1 + weeksAhead) % 3) + 1;
}

function tagToKind(tag: string) {
  if (tag === "crock") return "crock";
  if (tag === "lazy") return "lazy";
  return "dinner";
}

type Recipe = {
  title: string;
  servings: string;
  prep_time: string;
  cook_time: string;
  ingredients: { item: string; amount: string; note: string }[];
  steps: string[];
  tips: string[];
  when_to_start: string;
};

export default function Planner({ initialItems, initialDinners, initialExpenses, initialHousehold }: Props) {
  const [items, setItems] = useState(initialItems);
  const [dinners, setDinners] = useState(initialDinners);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [household, setHousehold] = useState(initialHousehold);
  const [isPending, startTransition] = useTransition();

  // UI surface state
  const [sheet, setSheet] = useState<"ai" | "import" | "stock" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [staplesOpen, setStaplesOpen] = useState(false);
  const [weekDetail, setWeekDetail] = useState<{ open: boolean; offset: number }>({ open: false, offset: 0 });

  // Top-level navigation — splits the single page into focused views so
  // it doesn't all stack at once. Persisted across reloads so wherever you
  // were is wherever you come back to.
  type TabKey = "tonight" | "week" | "shopping" | "budget";
  const [tab, setTab] = useState<TabKey>("tonight");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fossofam-tab");
      if (saved === "tonight" || saved === "week" || saved === "shopping" || saved === "budget") setTab(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("fossofam-tab", tab); } catch {}
  }, [tab]);

  // Live two-phone sync — refetch on focus + every 20s while visible.
  const isPendingRef = useRef(false);
  useEffect(() => { isPendingRef.current = isPending; }, [isPending]);
  useEffect(() => {
    let canceled = false;
    async function refresh() {
      if (canceled || document.hidden || isPendingRef.current) return;
      try {
        const s = await getAllState();
        if (canceled) return;
        setItems(s.items);
        setDinners(s.dinners);
        setExpenses(s.expenses);
        setHousehold(s.household);
      } catch { /* transient — next tick retries */ }
    }
    const onFocus = () => refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(refresh, 20_000);
    return () => {
      canceled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(id);
    };
  }, []);

  // Close header menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest(".hdr-menu") && !t.closest(".hdr-menu-btn")) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // ---- mutations (optimistic + persist) ----
  function doAddItem(name: string, store: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = store === "auto" ? routeStore(trimmed) : store;
    const temp: Item = { id: Date.now(), name: trimmed, store: s, done: false, cost: null, costAt: null, createdAt: new Date() };
    setItems((p) => [...p, temp]);
    startTransition(() => addItem(trimmed, store));
  }
  function doToggle(id: number, done: boolean) {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, done } : i)));
    startTransition(() => toggleItem(id, done));
  }
  function doDelete(id: number) {
    setItems((p) => p.filter((i) => i.id !== id));
    startTransition(() => deleteItem(id));
  }
  function doClearChecked() {
    setItems((p) => p.filter((i) => !i.done));
    startTransition(() => clearCheckedItems());
  }
  function doUpdateItemCost(id: number, cost: number | null) {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, cost, costAt: cost === null ? null : new Date() } : i)));
    startTransition(() => updateItemCost(id, cost));
  }
  function doReassignItems(ids: number[], store: string) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setItems((p) => p.map((i) => (idSet.has(i.id) ? { ...i, store, done: false } : i)));
    startTransition(() => reassignItems(ids, store));
  }
  function doBulkDeleteItems(ids: number[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setItems((p) => p.filter((i) => !idSet.has(i.id)));
    startTransition(() => bulkDeleteItems(ids));
  }
  function doUpdateMeal(id: number, meal: string) {
    setDinners((p) => p.map((d) => (d.id === id ? { ...d, meal } : d)));
    startTransition(() => updateDinnerMeal(id, meal));
  }
  function doSkip(id: number, skip: boolean, reason: string) {
    setDinners((p) => p.map((d) => (d.id === id ? { ...d, skip, skipReason: reason } : d)));
    startTransition(() => setDinnerSkip(id, skip, reason));
  }
  function doAddExpense(name: string, amount: number, kind: string) {
    if (!amount || amount <= 0) return;
    const temp: Expense = { id: Date.now(), name: name || "Expense", amount, kind, category: "groceries", createdAt: new Date() };
    setExpenses((p) => [...p, temp]);
    startTransition(() => addExpense(name, amount, kind));
  }
  function doDeleteExpense(id: number) {
    setExpenses((p) => p.filter((e) => e.id !== id));
    startTransition(() => deleteExpense(id));
  }
  function doCloseWeek() {
    const weekly = expenses.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
    if (weekly === 0 && !confirm("No weekly expenses logged yet. Close out anyway?")) return;
    if (!confirm(`Snapshot this week's $${Math.round(weekly)} as last week and roll the cycle to the next week?`)) return;
    setHousehold((p) => ({
      ...p,
      lastWeekTotal: weekly,
      currentWeek: p.currentWeek === 3 ? 1 : p.currentWeek + 1,
    }));
    setExpenses([]);
    setDinners((p) => p.map((d) => ({ ...d, skip: false, skipReason: "" })));
    startTransition(() => closeOutWeek());
  }
  function doClearLastWeek() {
    setHousehold((p) => ({ ...p, lastWeekTotal: null }));
    startTransition(() => clearLastWeek());
  }

  // Recipe sheet (opened from the 📖 action on any dinner)
  const [recipeSheetState, setRecipeSheetState] = useState<{
    open: boolean;
    meal: string;
    kind: string;
    loading: boolean;
    error: string | null;
    recipe: Recipe | null;
    cached: boolean;
  }>({ open: false, meal: "", kind: "dinner", loading: false, error: null, recipe: null, cached: false });

  async function getRecipe(meal: string, kind: string, forceFresh: boolean = false) {
    if (!meal.trim()) return;
    setRecipeSheetState({ open: true, meal, kind, loading: true, error: null, recipe: null, cached: false });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_recipe", note: "", meal, kind, forceFresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setRecipeSheetState((s) => ({ ...s, loading: false, recipe: data.proposal, cached: !!data.cached }));
    } catch (e) {
      setRecipeSheetState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Unknown error" }));
    }
  }

  function closeRecipeSheet() {
    setRecipeSheetState({ open: false, meal: "", kind: "dinner", loading: false, error: null, recipe: null, cached: false });
  }

  // Per-row sub-pickers (skip-reason picker, swap-idea picker)
  const [rowMenu, setRowMenu] = useState<{ dinnerId: number; type: "skip" | "swap" } | null>(null);
  function toggleRowMenu(dinnerId: number, type: "skip" | "swap") {
    setRowMenu((m) => (m && m.dinnerId === dinnerId && m.type === type ? null : { dinnerId, type }));
  }
  function applySkipReason(d: Dinner, reason: string) {
    doSkip(d.id, true, reason);
    setRowMenu(null);
    setActiveRow(null);
  }
  function applySwap(d: Dinner, idea: string, tag: string, label: string) {
    setDinners((p) => p.map((x) => (x.id === d.id ? { ...x, meal: idea, tag, label } : x)));
    startTransition(() => updateDinnerSlot(d.id, { meal: idea, tag, label }));
    setRowMenu(null);
    setActiveRow(null);
  }

  // AI fresh-idea state per swap-open dinner. Lives in Planner so it
  // resets when the user moves between days.
  const [aiSwap, setAiSwap] = useState<{
    dinnerId: number;
    loading: boolean;
    error: string | null;
    meal?: string;
    label?: string;
    note?: string;
    reason?: string;
  } | null>(null);

  async function fetchAiIdea(d: Dinner) {
    setAiSwap({ dinnerId: d.id, loading: true, error: null });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "suggest_meal",
          note: "",
          day: d.day,
          kind: d.tag,
          dinners,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setAiSwap({
        dinnerId: d.id,
        loading: false,
        error: null,
        meal: data.proposal.meal,
        label: data.proposal.label,
        note: data.proposal.note,
        reason: data.proposal.reason,
      });
    } catch (e) {
      setAiSwap({
        dinnerId: d.id,
        loading: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  function applyAiIdea(d: Dinner) {
    if (!aiSwap || aiSwap.dinnerId !== d.id || !aiSwap.meal) return;
    applySwap(d, aiSwap.meal, d.tag, aiSwap.label || d.label);
    setAiSwap(null);
  }
  function skipOther(d: Dinner) {
    const r = prompt(`Skip ${d.day} — reason?`, "Leftovers");
    if (r === null) return;
    applySkipReason(d, r.trim() || "No dinner needed");
  }

  // ---- derived ----
  const currentWeek = household.currentWeek;
  const active = items.filter((i) => !i.done);
  const weeklySpent = expenses.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
  const bulkSpent = expenses.filter((e) => e.kind === "bulk").reduce((s, e) => s + e.amount, 0);
  const remain = WEEKLY_TARGET - weeklySpent;
  const pct = Math.min(100, Math.round((weeklySpent / WEEKLY_TARGET) * 100));
  const over = remain < 0;

  const todayDate = new Date();
  const todayIdx = todayDate.getDay();
  const todayName = DAY_NAMES[todayIdx];
  const tomorrowName = DAY_NAMES[(todayIdx + 1) % 7];
  const today = dinners.find((d) => d.day === todayName) ?? dinners[0];
  const tomorrow = dinners.find((d) => d.day === tomorrowName) ?? dinners[0];
  const weekDates = datesForCurrentWeek(todayDate);

  const itemsByStore = STORE_ORDER
    .map((sk) => ({
      key: sk,
      store: STORE[sk],
      target: ROUTE_PLAN.find((r) => r.key === sk)?.target ?? 0,
      fallback: ROUTE_PLAN.find((r) => r.key === sk)?.fallback ?? null,
      items: items.filter((i) => i.store === sk),
    }))
    .filter((g) => g.items.length > 0);
  const onlineActive = active.filter((i) => i.store === "online");

  return (
    <div className="wrap">
      {recipeSheetState.open && (
        <RecipeSheet
          meal={recipeSheetState.meal}
          loading={recipeSheetState.loading}
          error={recipeSheetState.error}
          recipe={recipeSheetState.recipe}
          cached={recipeSheetState.cached}
          onClose={closeRecipeSheet}
          onRegenerate={() => getRecipe(recipeSheetState.meal, recipeSheetState.kind, true)}
        />
      )}

      <header className="top">
        <h1>FossoFam</h1>
        <button className="hdr-menu-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="More">⋯</button>
        {menuOpen && (
          <div className="hdr-menu">
            <button onClick={() => { setSheet("ai"); setMenuOpen(false); }}><i className="ti ti-sparkles" /> Modify week</button>
            <button onClick={() => { setSheet("import"); setMenuOpen(false); }}><i className="ti ti-link" /> Import recipe</button>
            <button onClick={() => { setMenuOpen(false); doCloseWeek(); }}><i className="ti ti-calendar-stats" /> Close out week</button>
          </div>
        )}
      </header>

      <nav className="tab-nav" aria-label="Sections">
        <button className={tab === "tonight" ? "active" : ""} onClick={() => setTab("tonight")}>🔥 Tonight</button>
        <button className={tab === "week" ? "active" : ""} onClick={() => setTab("week")}>📅 Week</button>
        <button className={tab === "shopping" ? "active" : ""} onClick={() => setTab("shopping")}>🛒 Shopping</button>
        <button className={tab === "budget" ? "active" : ""} onClick={() => setTab("budget")}>💰 Budget</button>
      </nav>

      {(tab === "tonight" || tab === "week") && (
        <WeekCarousel
          currentCyclePos={currentWeek}
          onSelect={(offset) => setWeekDetail({ open: true, offset })}
        />
      )}

      {weekDetail.open && (() => {
        const start = sundayOfWeek(new Date(), weekDetail.offset);
        const cyclePos = cyclePosFor(currentWeek, weekDetail.offset);
        const meta = WEEKS.find((w) => w.n === cyclePos) ?? WEEKS[0];
        return (
          <SheetOverlay onClose={() => setWeekDetail({ open: false, offset: 0 })}>
            <WeekDetailSheet
              weekStart={start}
              cyclePos={cyclePos}
              meta={meta}
              dinners={dinners}
              isCurrent={weekDetail.offset === 0}
              onClose={() => setWeekDetail({ open: false, offset: 0 })}
            />
          </SheetOverlay>
        );
      })()}

      {/* The dinner→shopping gap nudge. Shown on Tonight + Shopping tabs so
          it's hard to miss either when landing or when you're about to shop. */}
      {(tab === "tonight" || tab === "shopping") && (() => {
        const realDinners = dinners.filter((d) => !d.skip && d.meal && d.meal.trim().length > 0);
        const shoppingItems = items.filter((i) => !i.done);
        const gap = realDinners.length >= 3 && shoppingItems.length < realDinners.length;
        if (!gap) return null;
        return (
          <div className="stock-nudge" onClick={() => setSheet("stock")}>
            <div className="sn-text">
              <strong>You have {realDinners.length} dinners planned but only {shoppingItems.length} items on the list.</strong>
              <div className="sn-sub">Tap to auto-build the week&apos;s shopping from your meals.</div>
            </div>
            <span className="sn-cta">🛒 Stock it</span>
          </div>
        );
      })()}

      {/* ============ TONIGHT + TOMORROW ============ */}
      {tab === "tonight" && (
        <section className="card">
          <div className="dash-card-head"><i className="ti ti-flame" /><h2>Tonight · {todayName}</h2></div>
          <DinnerSpotlight d={today} prominent onSkip={(d) => toggleRowMenu(d.id, "skip")} onUnskip={() => doSkip(today.id, false, "")} getRecipe={getRecipe} />
          <div className="dash-card-head" style={{ marginTop: 18 }}><i className="ti ti-calendar" /><h2 style={{ fontSize: 16 }}>Tomorrow · {tomorrowName}</h2></div>
          <DinnerSpotlight d={tomorrow} prominent={false} onSkip={(d) => toggleRowMenu(d.id, "skip")} onUnskip={() => doSkip(tomorrow.id, false, "")} getRecipe={getRecipe} />
        </section>
      )}

      {/* ============ THIS WEEK ============ */}
      {tab === "week" && (
        <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <h2>Week of {weekOfLabel()}</h2>
          <button className="stock-btn" onClick={() => setSheet("stock")}>🛒 Stock list</button>
        </div>
        <div>
          {dinners.map((d) => {
            const skipOpen = rowMenu?.dinnerId === d.id && rowMenu.type === "skip";
            const swapOpen = rowMenu?.dinnerId === d.id && rowMenu.type === "swap";
            const dateForDay = weekDates[d.day];
            const isToday = dateForDay ? isSameYMD(dateForDay, todayDate) : false;
            const dateLabel = dateForDay
              ? dateForDay.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "";
            const isActive = activeRow === d.id;
            return (
              <div key={d.id}>
                <div className={"day-row" + (d.skip ? " skipped" : "") + (isToday ? " today" : "")}>
                  <div className="day-row-head">
                    <span className="day-name">{d.day}</span>
                    {dateLabel && <span className="day-date">· {dateLabel}</span>}
                    {isToday && <span className="day-today-pill">today</span>}
                    <span style={{ flex: 1 }} />
                    {!d.skip && <span className={"day-tag t-" + d.tag} aria-label={d.label} />}
                    {d.skip ? (
                      <button className="row-actions-btn" onClick={() => doSkip(d.id, false, "")} aria-label="Un-skip">↩</button>
                    ) : (
                      <button
                        className={"row-actions-btn" + (isActive ? " active" : "")}
                        onClick={() => setActiveRow(isActive ? null : d.id)}
                        aria-label="Actions"
                      >⋯</button>
                    )}
                  </div>
                  {d.skip ? (
                    <div className="skip-reason">{d.skipReason || "No dinner needed"}</div>
                  ) : (
                    <>
                      <input
                        className="meal-input"
                        defaultValue={d.meal}
                        onBlur={(e) => { if (e.target.value !== d.meal) doUpdateMeal(d.id, e.target.value); }}
                      />
                      {d.note && <div className="gf-mini">{d.note}</div>}
                    </>
                  )}
                  {isActive && !d.skip && (
                    <div className="day-actions">
                      <button className="swap-btn recipe-btn" onClick={() => getRecipe(d.meal, tagToKind(d.tag))} aria-label="Recipe">📖</button>
                      <button className={"swap-btn" + (swapOpen ? " recipe-btn" : "")} onClick={() => toggleRowMenu(d.id, "swap")} aria-label="Swap">↺</button>
                      <button className="swap-btn skip-btn" onClick={() => toggleRowMenu(d.id, "skip")} aria-label="Skip">✕</button>
                    </div>
                  )}
                </div>
                {skipOpen && (
                  <div className="row-sub">
                    <div className="ideas">
                      {SKIP_REASONS.map((r) => (
                        <button key={r} className="idea-chip" onClick={() => applySkipReason(d, r)}>{r}</button>
                      ))}
                      <button className="idea-chip" onClick={() => skipOther(d)}>Other…</button>
                    </div>
                  </div>
                )}
                {swapOpen && (
                  <div className="row-sub">
                    {/* AI fresh idea — generates one new meal idea for this
                        day at the same effort tier. Cheap to re-roll. */}
                    <div style={{ marginBottom: 10 }}>
                      <div className="row-sub-label">✨ AI</div>
                      {aiSwap?.dinnerId === d.id && aiSwap.meal ? (
                        <div className="ai-suggestion">
                          <div className="ai-meal">{aiSwap.meal}</div>
                          {aiSwap.reason && <div className="ai-reason">{aiSwap.reason}</div>}
                          {aiSwap.note && <div className="gf-mini" style={{ marginTop: 4 }}>{aiSwap.note}</div>}
                          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                            <button className="btn-primary" onClick={() => applyAiIdea(d)}>Use it</button>
                            <button className="btn-ghost" onClick={() => fetchAiIdea(d)}>🎲 Another</button>
                            <button className="btn-ghost" onClick={() => setAiSwap(null)}>Hide</button>
                          </div>
                        </div>
                      ) : aiSwap?.dinnerId === d.id && aiSwap.loading ? (
                        <div className="ai-suggestion">Thinking…</div>
                      ) : aiSwap?.dinnerId === d.id && aiSwap.error ? (
                        <div className="ai-suggestion" style={{ color: "var(--coral-ink)" }}>
                          {aiSwap.error}
                          <div style={{ marginTop: 8 }}>
                            <button className="btn-ghost" onClick={() => fetchAiIdea(d)}>Try again</button>
                          </div>
                        </div>
                      ) : (
                        <button className="idea-chip ai-trigger" onClick={() => fetchAiIdea(d)}>
                          ✨ Fresh AI idea for {d.day}
                        </button>
                      )}
                    </div>

                    {SWAP_OPTIONS.map((group) => (
                      <div key={group.tier} style={{ marginBottom: 8 }}>
                        <div className="row-sub-label">{group.tier}</div>
                        <div className="ideas">
                          {group.ideas.map((idea) => (
                            <button
                              key={idea}
                              className="idea-chip"
                              onClick={() => applySwap(d, idea, group.tag, group.label)}
                            >
                              {idea}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      )}

      {/* ============ SHOPPING ============ */}
      {tab === "shopping" && (
      <ShoppingSection
        items={items}
        active={active}
        itemsByStore={itemsByStore}
        onlineActive={onlineActive}
        currentWeek={currentWeek}
        onAddItem={doAddItem}
        onToggle={doToggle}
        onDelete={doDelete}
        onClearChecked={doClearChecked}
        onUpdateCost={doUpdateItemCost}
        onReassign={doReassignItems}
        onBulkDelete={doBulkDeleteItems}
        onLogTrip={(name, amount, kind) => doAddExpense(name, amount, kind)}
        onApplyReceipt={(payload) => {
          const now = new Date();
          const updateMap = new Map(payload.updates.map((u) => [u.id, u.cost]));
          setItems((p) => {
            const updated = p.map((i) =>
              updateMap.has(i.id)
                ? { ...i, cost: updateMap.get(i.id)!, costAt: now, done: true }
                : i,
            );
            const added = payload.adds.map((a, idx) => ({
              id: Date.now() + idx,
              name: a.name,
              store: a.store,
              done: true,
              cost: a.cost,
              costAt: now,
              createdAt: now,
            }));
            return [...updated, ...added];
          });
          setExpenses((p) => [
            ...p,
            {
              id: Date.now() + 9999,
              name: payload.expense.name || "Shopping trip",
              amount: payload.expense.amount,
              kind: payload.expense.kind,
              category: "groceries",
              createdAt: now,
            },
          ]);
          startTransition(() => applyReceipt(payload));
        }}
        staplesOpen={staplesOpen}
        setStaplesOpen={setStaplesOpen}
      />
      )}

      {/* Budget strip — at-a-glance on every non-budget tab. Tap → switches
          to the Budget tab. Keeps spend visible without taking up tab space. */}
      {tab !== "budget" && (
        <div className="budget-strip" onClick={() => setTab("budget")}>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>${Math.round(weeklySpent)}</span>
          <span style={{ color: "var(--ink-3)" }}>of ${WEEKLY_TARGET}</span>
          <span style={{ color: "var(--ink-3)" }}>·</span>
          <span className={over ? "over" : "ok"}>{over ? `$${Math.abs(Math.round(remain))} over` : `$${Math.round(remain)} left`}</span>
          <span className="caret">›</span>
        </div>
      )}
      {tab === "budget" && (
        <BudgetSection
          expenses={expenses}
          weeklySpent={weeklySpent}
          bulkSpent={bulkSpent}
          remain={remain}
          pct={pct}
          over={over}
          household={household}
          currentWeek={currentWeek}
          onAddExpense={doAddExpense}
          onDeleteExpense={doDeleteExpense}
          onClearLastWeek={doClearLastWeek}
        />
      )}

      {/* ============ SHEETS ============ */}
      {sheet === "ai" && (
        <SheetOverlay onClose={() => setSheet(null)}>
          <AiModifyWeek
            dinners={dinners}
            items={items}
            currentWeek={currentWeek}
            onApply={(changes, additions, proposalId) => {
              setDinners((p) => p.map((d) => {
                const c = changes.find((x) => x.day === d.day);
                return c ? { ...d, meal: c.meal, tag: c.tag, label: c.label, note: c.note, skip: c.skip, skipReason: c.skipReason } : d;
              }));
              setItems((p) => [
                ...p,
                ...additions.map((a, idx) => ({
                  id: Date.now() + idx,
                  name: a.name,
                  store: a.store,
                  done: false,
                  cost: null,
                  costAt: null,
                  createdAt: new Date(),
                })),
              ]);
              startTransition(() => applyPlanChanges(changes, additions, proposalId));
              setSheet(null);
            }}
            onReject={(proposalId) => {
              if (proposalId !== undefined) startTransition(() => rejectProposal(proposalId));
              setSheet(null);
            }}
          />
        </SheetOverlay>
      )}

      {sheet === "stock" && (
        <SheetOverlay onClose={() => setSheet(null)}>
          <PlanShoppingPanel
            dinners={dinners}
            items={items}
            currentWeek={currentWeek}
            onApply={(additions, proposalId) => {
              const now = new Date();
              setItems((p) => [
                ...p,
                ...additions.map((a, idx) => ({
                  id: Date.now() + idx,
                  name: a.name,
                  store: a.store,
                  done: false,
                  cost: null,
                  costAt: null,
                  createdAt: now,
                })),
              ]);
              // Reuse applyPlanChanges (empty changes, additions only) so the
              // proposal gets marked applied + items persist via one action.
              startTransition(() =>
                applyPlanChanges([], additions.map((a) => ({ name: a.name, store: a.store })), proposalId),
              );
              setSheet(null);
            }}
            onReject={(proposalId) => {
              if (proposalId !== undefined) startTransition(() => rejectProposal(proposalId));
              setSheet(null);
            }}
          />
        </SheetOverlay>
      )}

      {sheet === "import" && (
        <SheetOverlay onClose={() => setSheet(null)}>
          <RecipeImport
            onApply={(day, payload, additions, proposalId) => {
              setDinners((p) => p.map((d) =>
                d.day === day
                  ? { ...d, meal: payload.title, tag: payload.tag, label: payload.label, note: `Steps: ${payload.steps.join(" | ")}`.slice(0, 1500) }
                  : d,
              ));
              setItems((p) => [
                ...p,
                ...additions.map((a, idx) => ({
                  id: Date.now() + idx,
                  name: a.name,
                  store: a.store,
                  done: false,
                  cost: null,
                  costAt: null,
                  createdAt: new Date(),
                })),
              ]);
              startTransition(() => applyImportedRecipe(day, payload, additions, proposalId));
              setSheet(null);
            }}
            onReject={(proposalId) => {
              if (proposalId !== undefined) startTransition(() => rejectProposal(proposalId));
              setSheet(null);
            }}
          />
        </SheetOverlay>
      )}
    </div>
  );
}

/* ---------- Week carousel ---------- */
// Read-only summary of the current calendar week + the next four. Shows
// where the user is in the 1→2→3 cycle (normal / feed / bulk), the budget
// for that week, and a one-liner note. Tapping cards is a no-op for now —
// purely informational so the family can see what's coming.
function WeekCarousel({ currentCyclePos, onSelect }: { currentCyclePos: number; onSelect: (offset: number) => void }) {
  const now = new Date();
  const cards = Array.from({ length: 5 }, (_, offset) => {
    const start = sundayOfWeek(now, offset);
    const cyclePos = cyclePosFor(currentCyclePos, offset);
    const meta = WEEKS.find((w) => w.n === cyclePos) ?? WEEKS[0];
    const tagClass = cyclePos === 3 ? "wc-bulk" : cyclePos === 2 ? "wc-feed" : "wc-normal";
    const tagLabel = cyclePos === 3 ? "Bulk week" : cyclePos === 2 ? "Feed week" : "Normal week";
    const heading =
      offset === 0 ? "This week" :
      offset === 1 ? "Next week" :
      `In ${offset} weeks`;
    return { offset, start, cyclePos, meta, tagClass, tagLabel, heading };
  });
  return (
    <div className="week-carousel" aria-label="Upcoming weeks">
      {cards.map((c) => (
        <button
          key={c.offset}
          className={"wc-card" + (c.offset === 0 ? " wc-current" : "")}
          onClick={() => onSelect(c.offset)}
        >
          <div className="wc-label">{c.heading}</div>
          <div className="wc-dates">{weekRangeLabel(c.start)}</div>
          <div className={"wc-tag " + c.tagClass}>{c.tagLabel}</div>
          <div className="wc-budget">{c.meta.budget}</div>
          <div className="wc-desc">{c.meta.desc}</div>
        </button>
      ))}
    </div>
  );
}

/* ---------- Week detail sheet ---------- */
function WeekDetailSheet({
  weekStart, cyclePos, meta, dinners, isCurrent, onClose,
}: {
  weekStart: Date;
  cyclePos: number;
  meta: typeof WEEKS[number];
  dinners: Dinner[];
  isCurrent: boolean;
  onClose: () => void;
}) {
  const tagLabel = cyclePos === 3 ? "Bulk week" : cyclePos === 2 ? "Feed week" : "Normal week";
  return (
    <div>
      <h2 className="sheet-h2">{weekRangeLabel(weekStart)}</h2>
      <div className="receipt-summary">
        <div className="rs-block">
          <div className="rs-label">Cycle</div>
          <div className="rs-val" style={{ fontSize: 17 }}>{tagLabel}</div>
        </div>
        <div className="rs-block">
          <div className="rs-label">Budget</div>
          <div className="rs-val" style={{ fontSize: 17 }}>{meta.budget}</div>
        </div>
      </div>

      <div className="note" style={{ marginBottom: 12 }}>{meta.desc}</div>

      {meta.tags && meta.tags.length > 0 && (
        <div className="ideas" style={{ marginBottom: 14 }}>
          {meta.tags.map((t, i) => (
            <span key={i} className="idea-chip" style={{ cursor: "default" }}>{t[1]}</span>
          ))}
        </div>
      )}

      <div className="sheet-h3">Dinners</div>
      {!isCurrent && (
        <div className="note" style={{ marginTop: 4, marginBottom: 8 }}>
          Per-week plans are coming. For now this shows your standing 7-day rotation projected forward.
        </div>
      )}

      {DAY_NAMES.map((day, i) => {
        const d = dinners.find((x) => x.day === day);
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        const dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <div key={day} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span className="day-name" style={{ fontSize: 14 }}>{day}</span>
              <span className="day-date">· {dateLabel}</span>
              <span style={{ flex: 1 }} />
              {d && !d.skip && <span className={"day-tag t-" + d.tag}>{d.label}</span>}
              {d?.skip && <span className="day-tag t-skip">Skipped</span>}
            </div>
            <div style={{ fontSize: 15 }}>{d?.skip ? (d.skipReason || "No dinner needed") : (d?.meal || "—")}</div>
            {d?.note && !d.skip && <div className="gf-mini">{d.note}</div>}
          </div>
        );
      })}

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/* ---------- Sheet wrapper (bottom modal) ---------- */
function SheetOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} className="sheet-bg">
      <div onClick={(e) => e.stopPropagation()} className="sheet">
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}

/* ---------- Tonight / Tomorrow spotlight ---------- */
function DinnerSpotlight({
  d, prominent, onSkip, onUnskip, getRecipe,
}: {
  d: Dinner;
  prominent: boolean;
  onSkip: (d: Dinner) => void;
  onUnskip: () => void;
  getRecipe: (meal: string, kind: string) => void;
}) {
  if (d.skip) {
    return (
      <div>
        <div className="dash-tom-meal" style={{ color: "var(--ink-3)", fontSize: prominent ? 22 : 16 }}>No dinner needed</div>
        <span className="dash-tom-tag t-skip">Skipped</span>
        {d.skipReason && <div className="dash-tom-note">{d.skipReason}</div>}
        <button className="swap-btn" style={{ marginTop: 10 }} onClick={onUnskip} aria-label="Un-skip">↩</button>
      </div>
    );
  }
  return (
    <div>
      <div className="dash-tom-meal" style={{ fontSize: prominent ? 22 : 16 }}>{d.meal || "—"}</div>
      <span className={"dash-tom-tag t-" + d.tag}>{d.label}</span>
      {d.note && <div className="dash-tom-note">{d.note}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="swap-btn recipe-btn" onClick={() => getRecipe(d.meal, tagToKind(d.tag))} aria-label="Recipe">📖</button>
        <button className="swap-btn skip-btn" onClick={() => onSkip(d)} aria-label="Skip">✕</button>
      </div>
    </div>
  );
}

/* ---------- Shopping ---------- */
type Receipt = {
  store: string;
  total: number;
  subtotal: number;
  tax: number;
  matched: {
    item_id: number;
    cart_name: string;
    receipt_name: string;
    price_in_cart: number | null;
    price_on_receipt: number;
  }[];
  receipt_only: {
    receipt_name: string;
    price: number;
    suggested_store: string;
  }[];
  cart_only: {
    item_id: number;
    cart_name: string;
    cart_price: number | null;
  }[];
  notes: string;
};

type ReceiptApplyPayload = {
  updates: { id: number; cost: number }[];
  adds: { name: string; store: string; cost: number }[];
  expense: { name: string; amount: number; kind: string };
};

// Client-side image compress so we stay under Vercel's 4.5MB body limit and
// keep model input tokens reasonable. ~1600px on the long side at q=0.85
// still reads small receipt text fine.
async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<{ base64: string; mediaType: string }> {
  const img = document.createElement("img");
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to read image"));
      img.src = objectUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
    const w = Math.max(1, Math.round((img.width || maxDim) * scale));
    const h = Math.max(1, Math.round((img.height || maxDim) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const idx = dataUrl.indexOf(",");
    return { base64: dataUrl.slice(idx + 1), mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Per-item cost is persisted on the items table (item.cost, item.costAt).
// Shop mode is a *view* — it surfaces the $ field next to each row and a
// running trip total. The data itself is durable: next week's "Apples"
// row comes pre-filled with the last price, and the agent can ground its
// budget proposals in real receipt numbers.
function ShoppingSection({
  items, active, itemsByStore, onlineActive, currentWeek,
  onAddItem, onToggle, onDelete, onClearChecked, onUpdateCost, onLogTrip, onApplyReceipt,
  onReassign, onBulkDelete,
  staplesOpen, setStaplesOpen,
}: {
  items: Item[];
  active: Item[];
  itemsByStore: { key: string; store: typeof STORE[string]; target: number; fallback: string | null; items: Item[] }[];
  onlineActive: Item[];
  currentWeek: number;
  onAddItem: (name: string, store: string) => void;
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
  onClearChecked: () => void;
  onUpdateCost: (id: number, cost: number | null) => void;
  onLogTrip: (name: string, amount: number, kind: string) => void;
  onApplyReceipt: (payload: ReceiptApplyPayload) => void;
  onReassign: (ids: number[], store: string) => void;
  onBulkDelete: (ids: number[]) => void;
  staplesOpen: boolean;
  setStaplesOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const [val, setVal] = useState("");
  const [shopMode, setShopMode] = useState(false);
  // Local edit buffer keyed by item id. Only used while the field is being
  // edited; on blur we persist to the DB via onUpdateCost.
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});

  // Anchor store — where the family is doing the main shop this week. The
  // list filters to this store; everything else collapses behind "Elsewhere".
  // Persisted locally so it survives refresh, defaults to whichever store
  // has the most items (or the user's last pick if any).
  const [activeStore, setActiveStore] = useState<string>("");
  const [elsewhereOpen, setElsewhereOpen] = useState(false);
  const userPickedStoreRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fossofam-active-store");
      if (saved && STORE[saved]) {
        setActiveStore(saved);
        userPickedStoreRef.current = true;
      }
    } catch {}
  }, []);

  // If the user hasn't explicitly picked a store, default to the one with the
  // most active items. Keeps a single source of truth without surprising the
  // user after they pick.
  useEffect(() => {
    if (userPickedStoreRef.current) return;
    if (!items.length) return;
    const counts: Record<string, number> = {};
    for (const i of items) {
      if (i.done) continue;
      if (i.store === "online") continue;
      counts[i.store] = (counts[i.store] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top && top !== activeStore) setActiveStore(top);
  }, [items, activeStore]);

  // Persist whenever activeStore changes (covers both auto-default and explicit
  // user pick). Other surfaces (PlanShoppingPanel) read from this key.
  useEffect(() => {
    if (!activeStore) return;
    try { localStorage.setItem("fossofam-active-store", activeStore); } catch {}
  }, [activeStore]);

  function pickStore(key: string) {
    setActiveStore(key);
    userPickedStoreRef.current = true;
  }

  // Overflow sheet — surfaces leftovers at the active store after a trip
  // and lets the user roll them to the next store or skip them.
  const [overflowSheet, setOverflowSheet] = useState<{ open: boolean; items: Item[] }>({ open: false, items: [] });
  function closeOverflow() { setOverflowSheet({ open: false, items: [] }); }
  function overflowReassign(ids: number[], store: string) {
    onReassign(ids, store);
    closeOverflow();
    pickStore(store);  // move the user to the new anchor automatically
  }
  function overflowSkip(ids: number[]) {
    onBulkDelete(ids);
    closeOverflow();
  }

  // Receipt scan state.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [receiptSheet, setReceiptSheet] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    receipt: Receipt | null;
    // Per-row decisions on apply. Defaults to "accept" for everything;
    // user can flip individual entries off before tapping Apply.
    matchedKeep: Record<number, boolean>;
    receiptOnlyKeep: Record<number, boolean>;
  }>({ open: false, loading: false, error: null, receipt: null, matchedKeep: {}, receiptOnlyKeep: {} });

  async function handleReceiptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReceiptSheet({ open: true, loading: true, error: null, receipt: null, matchedKeep: {}, receiptOnlyKeep: {} });
    try {
      const { base64, mediaType } = await compressImage(file);
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "parse_receipt",
          note: "",
          imageBase64: base64,
          imageMediaType: mediaType,
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      const receipt = data.proposal as Receipt;
      // Default: accept all matched + all receipt-only adds.
      const matchedKeep: Record<number, boolean> = {};
      receipt.matched.forEach((m) => { matchedKeep[m.item_id] = true; });
      const receiptOnlyKeep: Record<number, boolean> = {};
      receipt.receipt_only.forEach((_, i) => { receiptOnlyKeep[i] = true; });
      setReceiptSheet({ open: true, loading: false, error: null, receipt, matchedKeep, receiptOnlyKeep });
    } catch (err) {
      setReceiptSheet({ open: true, loading: false, error: err instanceof Error ? err.message : "Unknown error", receipt: null, matchedKeep: {}, receiptOnlyKeep: {} });
    }
  }

  function closeReceiptSheet() {
    setReceiptSheet({ open: false, loading: false, error: null, receipt: null, matchedKeep: {}, receiptOnlyKeep: {} });
  }

  function applyReceiptDiff() {
    const r = receiptSheet.receipt;
    if (!r) return;
    const updates = r.matched
      .filter((m) => receiptSheet.matchedKeep[m.item_id])
      .map((m) => ({ id: m.item_id, cost: m.price_on_receipt }));
    const adds = r.receipt_only
      .filter((_, i) => receiptSheet.receiptOnlyKeep[i])
      .map((ro) => ({ name: ro.receipt_name, store: ro.suggested_store, cost: ro.price }));
    const kind = currentWeek === 3 ? "bulk" : "weekly";
    onApplyReceipt({
      updates,
      adds,
      expense: { name: r.store || "Shopping trip", amount: r.total, kind },
    });
    closeReceiptSheet();
    setShopMode(false);

    // Surface overflow at the anchor: items that won't be marked done by
    // either receipt-matching or what the user already checked in shop mode.
    if (activeStore) {
      const willBeDoneIds = new Set<number>([
        ...items.filter((i) => i.done).map((i) => i.id),
        ...updates.map((u) => u.id),
      ]);
      const leftovers = items.filter((i) => !willBeDoneIds.has(i.id) && i.store === activeStore);
      if (leftovers.length > 0) {
        setOverflowSheet({ open: true, items: leftovers });
      }
    }
  }

  // Persist shop-mode toggle only (cheap; nice to survive a refresh).
  useEffect(() => {
    try {
      if (localStorage.getItem("fossofam-shop-mode") === "1") setShopMode(true);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("fossofam-shop-mode", shopMode ? "1" : "0"); } catch {}
  }, [shopMode]);

  // Trip total = sum of cost over items currently *in the cart* (done=true).
  // Editing a price doesn't add to the total; checking the item does. This
  // matches the natural shop flow: enter price → tap into cart → next item.
  const tripTotal = items.reduce((s, i) => (i.done && i.cost ? s + i.cost : s), 0);
  const tripItemCount = items.filter((i) => i.done && i.cost && i.cost > 0).length;

  function submit() {
    if (!val.trim()) return;
    onAddItem(val, "auto");
    setVal("");
  }

  function commitPrice(id: number) {
    const raw = priceDraft[id];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      setPriceDraft((p) => { const { [id]: _, ...rest } = p; return rest; });
      return;
    }
    onUpdateCost(id, parsed);
    setPriceDraft((p) => { const { [id]: _, ...rest } = p; return rest; });
  }

  function priceFor(item: Item): string {
    if (priceDraft[item.id] !== undefined) return priceDraft[item.id];
    return item.cost == null ? "" : String(item.cost);
  }

  function logTrip() {
    if (tripTotal <= 0) {
      alert("Check items off as you grab them — total comes from items in the cart.");
      return;
    }
    // Default name: the anchor store, with a fallback to the store with most cart items.
    const storesByCount: Record<string, number> = {};
    for (const i of items) {
      if (!i.done || !i.cost || i.cost <= 0) continue;
      storesByCount[i.store] = (storesByCount[i.store] || 0) + 1;
    }
    const topStoreKey = Object.entries(storesByCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    const defaultName = activeStore && STORE[activeStore]
      ? STORE[activeStore].name
      : topStoreKey
      ? STORE[topStoreKey].name
      : "Shopping trip";
    const name = prompt(`Log $${tripTotal.toFixed(2)} as:`, defaultName);
    if (name === null) return;
    const kind = currentWeek === 3 ? "bulk" : "weekly";
    onLogTrip(name.trim() || defaultName, Math.round(tripTotal * 100) / 100, kind);
    setShopMode(false);

    // Surface overflow: items at the anchor store still unchecked.
    if (activeStore) {
      const leftovers = items.filter((i) => !i.done && i.store === activeStore);
      if (leftovers.length > 0) {
        setOverflowSheet({ open: true, items: leftovers });
      }
    }
  }

  return (
    <section className={"card" + (shopMode ? " shop-on" : "")}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <h2>Shopping</h2>
        <button
          className={"shop-mode-btn" + (shopMode ? " on" : "")}
          onClick={() => setShopMode((v) => !v)}
        >
          {shopMode ? "✕ exit shop" : "🛒 shop mode"}
        </button>
      </div>

      {shopMode && (
        <div className="shop-mode-bar">
          <div className="smb-totals">
            <div className="smb-total">${tripTotal.toFixed(2)}</div>
            <div className="smb-count">{tripItemCount} {tripItemCount === 1 ? "item" : "items"} in cart</div>
          </div>
          <button className="smb-receipt" onClick={() => fileInputRef.current?.click()} aria-label="Scan receipt">📷</button>
          <button className="btn-primary smb-log" onClick={logTrip}>Log trip</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleReceiptFile}
            style={{ display: "none" }}
          />
        </div>
      )}

      {receiptSheet.open && (
        <SheetOverlay onClose={closeReceiptSheet}>
          <ReceiptSheet
            state={receiptSheet}
            onToggleMatched={(itemId) =>
              setReceiptSheet((s) => ({ ...s, matchedKeep: { ...s.matchedKeep, [itemId]: !s.matchedKeep[itemId] } }))
            }
            onToggleReceiptOnly={(idx) =>
              setReceiptSheet((s) => ({ ...s, receiptOnlyKeep: { ...s.receiptOnlyKeep, [idx]: !s.receiptOnlyKeep[idx] } }))
            }
            onApply={applyReceiptDiff}
            onCancel={closeReceiptSheet}
          />
        </SheetOverlay>
      )}

      {overflowSheet.open && (
        <SheetOverlay onClose={closeOverflow}>
          <OverflowSheet
            items={overflowSheet.items}
            fromStoreName={activeStore && STORE[activeStore] ? STORE[activeStore].name : "this store"}
            currentStoreKey={activeStore}
            onSendTo={(storeKey) => overflowReassign(overflowSheet.items.map((i) => i.id), storeKey)}
            onSkip={() => overflowSkip(overflowSheet.items.map((i) => i.id))}
            onCancel={closeOverflow}
          />
        </SheetOverlay>
      )}

      {!shopMode && (
        <>
          <div className="add-row">
            <input
              className="txt"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Add item"
            />
            <button className="btn-primary" onClick={submit}>Add</button>
          </div>
          <div className="dash-quickadd">
            <button className="idea-chip" onClick={() => setStaplesOpen((v) => !v)}>
              {staplesOpen ? "− staples" : "+ staples"}
            </button>
            {staplesOpen && STAPLES.slice(0, 10).map((s) => (
              <button key={s} className="idea-chip" onClick={() => onAddItem(s, "auto")}>+ {s}</button>
            ))}
          </div>
        </>
      )}

      {items.length > 0 && (
        <div className="anchor-bar">
          <span className="ab-label">I&apos;m at</span>
          <div className="ab-select-wrap">
            <select
              className="ab-select"
              value={activeStore || "fred"}
              onChange={(e) => pickStore(e.target.value)}
            >
              {STORE_ORDER.filter((k) => k !== "online").map((k) => (
                <option key={k} value={k}>{STORE[k].name}</option>
              ))}
            </select>
          </div>
          <span className="ab-count">
            {(() => {
              const activeGroup = itemsByStore.find((g) => g.key === activeStore);
              const activeCount = activeGroup?.items.filter((i) => !i.done).length ?? 0;
              const elsewhereCount = itemsByStore
                .filter((g) => g.key !== activeStore && g.key !== "online")
                .reduce((s, g) => s + g.items.filter((i) => !i.done).length, 0);
              return (
                <>
                  <strong>{activeCount}</strong> here
                  {elsewhereCount > 0 && <> · {elsewhereCount} elsewhere</>}
                </>
              );
            })()}
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty" style={{ marginTop: 8 }}>All stocked.</div>
      ) : (
        <>
          {(() => {
            const allGroups = itemsByStore.filter((g) => g.key !== "online");
            const activeGroup = allGroups.find((g) => g.key === activeStore);
            const otherGroups = allGroups.filter((g) => g.key !== activeStore);
            const elsewhereTotal = otherGroups.reduce((s, g) => s + g.items.filter((i) => !i.done).length, 0);

            const renderGroup = (g: typeof allGroups[number]) => {
              const remaining = g.items.filter((i) => !i.done).length;
              const byArea = AREAS
                .map((a) => ({ area: a, items: g.items.filter((i) => routeArea(i.name) === a) }))
                .filter((sub) => sub.items.length > 0);
              const showAreaHeads = byArea.length > 1;
              const storeCartSubtotal = g.items.reduce((s, it) => (it.done && it.cost ? s + it.cost : s), 0);
              return (
                <div className="store-group" key={g.key}>
                  <div className="store-head">
                    <span className="store-name">
                      <span className="store-swatch" style={{ background: g.store.color }} />
                      {g.store.name}
                    </span>
                    <span className="store-meta">
                      {shopMode && storeCartSubtotal > 0 && (
                        <span style={{ marginRight: 8, fontWeight: 600, color: "var(--ink)" }}>${storeCartSubtotal.toFixed(2)}</span>
                      )}
                      {remaining}
                    </span>
                  </div>
                  {byArea.map((sub) => (
                    <div className="area-group" key={sub.area}>
                      {showAreaHeads && (
                        <div className="area-head">
                          <span className="area-icon">{AREA[sub.area].icon}</span>
                          {AREA[sub.area].name}
                        </div>
                      )}
                      {sub.items.map((it) => (
                        <div className={"item" + (it.done ? " done" : "")} key={it.id}>
                          <input type="checkbox" checked={it.done} onChange={(e) => onToggle(it.id, e.target.checked)} />
                          <span className="item-name">{it.name}</span>
                          {shopMode && (
                            <input
                              className="item-price"
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              placeholder="$"
                              value={priceFor(it)}
                              onChange={(e) => setPriceDraft((p) => ({ ...p, [it.id]: e.target.value }))}
                              onBlur={() => commitPrice(it.id)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              onFocus={(e) => e.target.select()}
                            />
                          )}
                          {!shopMode && <span className="item-x" onClick={() => onDelete(it.id)}>×</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                  {g.fallback && remaining > 0 && !shopMode && (
                    <div className="gf-mini" style={{ marginTop: 6 }}>
                      ↳ {STORE[g.fallback].name}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <>
                {activeGroup && renderGroup(activeGroup)}
                {!activeGroup && elsewhereTotal > 0 && (
                  <div className="empty" style={{ marginTop: 8 }}>Nothing for {STORE[activeStore]?.name ?? "this store"} yet — try expanding Elsewhere below.</div>
                )}
                {otherGroups.length > 0 && elsewhereTotal > 0 && (
                  <div className="elsewhere-section">
                    <button className="elsewhere-toggle" onClick={() => setElsewhereOpen((v) => !v)}>
                      <span>{elsewhereOpen ? "▾" : "▸"} Elsewhere</span>
                      <span className="elsewhere-count">{elsewhereTotal}</span>
                    </button>
                    {elsewhereOpen && otherGroups.map(renderGroup)}
                  </div>
                )}
              </>
            );
          })()}
          {onlineActive.length > 0 && !shopMode && (
            <div className="dash-online-cta">
              <i className="ti ti-world" />
              <div className="txt-wrap">
                <div className="oc-title">Online order</div>
                <div className="oc-items">{onlineActive.map((i) => i.name).join(" · ")}</div>
              </div>
              <button onClick={() => {
                const t = `Help me place an online order for these items (we like glass packaging, organic, mold-free coffee): ${onlineActive.map((i) => i.name).join(", ")}. Suggest where to buy each and rough prices.`;
                navigator.clipboard?.writeText(t).catch(() => {});
                alert("Order request copied to clipboard:\n\n" + t);
              }}>Draft ↗</button>
            </div>
          )}
          {!shopMode && (
            <div className="toolbar">
              <button className="btn-ghost" onClick={onClearChecked}>Clear checked</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- Budget (expanded panel — collapsed by default) ---------- */
function BudgetSection({
  expenses, weeklySpent, bulkSpent, remain, pct, over, household, currentWeek,
  onAddExpense, onDeleteExpense, onClearLastWeek,
}: {
  expenses: Expense[];
  weeklySpent: number;
  bulkSpent: number;
  remain: number;
  pct: number;
  over: boolean;
  household: Household;
  currentWeek: number;
  onAddExpense: (name: string, amount: number, kind: string) => void;
  onDeleteExpense: (id: number) => void;
  onClearLastWeek: () => void;
}) {
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const [kind, setKind] = useState(currentWeek === 3 ? "bulk" : "weekly");
  function submit() {
    const a = parseFloat(amt) || 0;
    if (a <= 0) return;
    onAddExpense(name, a, kind);
    setName("");
    setAmt("");
  }
  return (
    <section className="card">
      {household.lastWeekTotal !== null && (
        household.lastWeekTotal <= WEEKLY_TARGET ? (
          <div className="last-week-banner good">
            <i className="ti ti-check" />
            <div>Last week: <strong>${Math.round(household.lastWeekTotal)}</strong></div>
            <span className="lw-reset" onClick={onClearLastWeek}>clear</span>
          </div>
        ) : (
          <div className="last-week-banner over">
            <i className="ti ti-info-circle" />
            <div>Last week: <strong>${Math.round(household.lastWeekTotal)}</strong> — ${Math.round(household.lastWeekTotal - WEEKLY_TARGET)} over</div>
            <span className="lw-reset" onClick={onClearLastWeek}>clear</span>
          </div>
        )
      )}
      <div className="bar-track"><div className={"bar-fill" + (weeklySpent > WEEKLY_TARGET ? " over" : weeklySpent > WEEKLY_TARGET * 0.85 ? " warn" : "")} style={{ width: pct + "%" }} /></div>
      {bulkSpent > 0 && <div className="hint">+ ${Math.round(bulkSpent)} bulk envelope</div>}

      <div className="add-row" style={{ marginTop: 14 }}>
        <input
          className="txt"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Store / what for"
        />
        <input
          className="txt"
          type="number"
          min="0"
          step="1"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="$"
          style={{ maxWidth: 110, minWidth: 80 }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="weekly">Weekly</option>
          <option value="bulk">Bulk</option>
        </select>
        <button className="btn-primary" onClick={submit}>Add</button>
      </div>
      {expenses.length === 0 ? (
        <div className="empty" style={{ marginTop: 10 }}>No runs yet.</div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {expenses.map((e) => (
            <div className="budget-line" key={e.id}>
              <div className="bl-name">{e.name}<small>{e.kind === "bulk" ? "bulk" : "weekly"}</small></div>
              <div style={{ textAlign: "right", fontSize: 14 }}>${Math.round(e.amount)}</div>
              <div className="bl-store"><span className="item-x" style={{ opacity: 1, cursor: "pointer" }} onClick={() => onDeleteExpense(e.id)}>remove</span></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Recipe sheet ---------- */
function RecipeSheet({
  meal, loading, error, recipe, cached, onClose, onRegenerate,
}: {
  meal: string;
  loading: boolean;
  error: string | null;
  recipe: Recipe | null;
  cached: boolean;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  // Local override — when user runs modify_recipe, we replace the displayed
  // recipe with the modified version. The cached payload stays untouched
  // (substitution is per-cook, not a permanent edit).
  const [override, setOverride] = useState<(Recipe & { change_summary?: string }) | null>(null);
  const [modifyInput, setModifyInput] = useState("");
  const [modifyLoading, setModifyLoading] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);
  const displayed = override ?? recipe;

  // Reset modification state whenever the upstream recipe changes
  // (regenerate / open a different meal).
  useEffect(() => {
    setOverride(null);
    setModifyInput("");
    setModifyError(null);
  }, [recipe]);

  async function submitModify() {
    if (!modifyInput.trim() || !displayed) return;
    setModifyLoading(true);
    setModifyError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "modify_recipe",
          note: modifyInput,
          currentRecipe: displayed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setOverride(data.proposal);
      setModifyInput("");
    } catch (e) {
      setModifyError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setModifyLoading(false);
    }
  }

  return (
    <div onClick={onClose} className="sheet-bg">
      <div onClick={(e) => e.stopPropagation()} className="sheet">
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>

        {loading && (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>Writing recipe for</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{meal}</div>
          </div>
        )}

        {error && !loading && (
          <div style={{ padding: "16px 0" }}>
            <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 6 }}>Couldn&apos;t generate</div>
            <div className="hint" style={{ color: "var(--coral-ink, #c4452a)" }}>{error}</div>
          </div>
        )}

        {displayed && !loading && (
          <>
            {override?.change_summary && (
              <div className="last-week-banner good" style={{ marginBottom: 14 }}>
                <i className="ti ti-edit" />
                <div><strong>Changed:</strong> {override.change_summary}</div>
              </div>
            )}
            <h2 style={{ marginTop: 0, fontSize: 22, lineHeight: 1.25 }}>{displayed.title}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", margin: "8px 0 14px", fontSize: 13, color: "var(--ink-2)" }}>
              <span>🍽 {displayed.servings}</span>
              <span>⏱ {displayed.prep_time} prep</span>
              <span>🔥 {displayed.cook_time}</span>
              {cached && !override && <span className="cached-badge">saved</span>}
              {override && <span className="cached-badge" style={{ background: "var(--amber-bg)", color: "var(--amber-ink)" }}>modified</span>}
              <button className="btn-ghost" style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }} onClick={onRegenerate}>
                🔄 New version
              </button>
            </div>

            {displayed.when_to_start && (
              <div className="last-week-banner good" style={{ marginBottom: 14 }}>
                <i className="ti ti-clock" />
                <div><strong>Start by:</strong> {displayed.when_to_start}</div>
              </div>
            )}

            <h3 className="sheet-h3">Ingredients</h3>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
              {displayed.ingredients.map((ing, i) => (
                <li key={i}>
                  <strong>{ing.amount}</strong> {ing.item}
                  {ing.note && <span className="gf-mini" style={{ display: "inline", marginLeft: 6 }}>({ing.note})</span>}
                </li>
              ))}
            </ul>

            <h3 className="sheet-h3">Steps</h3>
            <ol style={{ paddingLeft: 22, margin: 0, fontSize: 14, lineHeight: 1.8 }}>
              {displayed.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{s.replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "")}</li>
              ))}
            </ol>

            {displayed.tips.length > 0 && (
              <>
                <h3 className="sheet-h3">Tips</h3>
                <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
                  {displayed.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            )}

            {/* Substitute / modify chat */}
            <div className="recipe-modify">
              <div className="sheet-h3">Out of something? Tweak it?</div>
              <div className="add-row" style={{ marginBottom: 0 }}>
                <input
                  className="txt"
                  type="text"
                  placeholder="e.g. out of cream, use chicken, kid version"
                  value={modifyInput}
                  onChange={(e) => setModifyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitModify(); }}
                  disabled={modifyLoading}
                />
                <button
                  className="btn-primary"
                  onClick={submitModify}
                  disabled={modifyLoading || !modifyInput.trim()}
                >
                  {modifyLoading ? "Thinking…" : "Ask"}
                </button>
              </div>
              {modifyError && (
                <div className="hint" style={{ color: "var(--coral-ink, #c4452a)", marginTop: 6 }}>{modifyError}</div>
              )}
              {override && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={async () => {
                      if (!override) return;
                      const defaultName = (override.title || "Recipe") + " (variant)";
                      const name = window.prompt("Save as variant — name?", defaultName);
                      if (!name?.trim()) return;
                      try {
                        await cacheRecipe(name.trim(), null, override);
                        alert(`Saved "${name.trim()}". Next time you ask for it, it's instant.`);
                      } catch (e) {
                        alert("Couldn't save: " + (e instanceof Error ? e.message : "unknown error"));
                      }
                    }}
                  >
                    💾 Save as variant
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => { setOverride(null); }}
                  >
                    ↩ revert to saved
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- AI modify-week (rendered inside a sheet) ---------- */
type ProposalDinnerChange = {
  day: string;
  meal: string;
  tag: string;
  label: string;
  note: string;
  skip: boolean;
  skipReason: string;
};

type ProposalAddition = {
  name: string;
  store: string;
};

type Proposal = {
  summary: string;
  estimated_weekly_cost?: number;
  budget_status?: "under" | "at" | "over";
  scrounge_suggestion?: string;
  dinner_changes: ProposalDinnerChange[];
  shopping_additions: ProposalAddition[];
};

function AiModifyWeek({
  dinners, items, currentWeek, onApply, onReject,
}: {
  dinners: Dinner[];
  items: Item[];
  currentWeek: number;
  onApply: (changes: ProposalDinnerChange[], additions: ProposalAddition[], proposalId?: number) => void;
  onReject: (proposalId?: number) => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalId, setProposalId] = useState<number | undefined>(undefined);

  async function submit() {
    setError(null);
    setProposal(null);
    setProposalId(undefined);
    if (!note.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "modify_week", note, dinners, items, currentWeek }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setProposal(data.proposal);
      setProposalId(data.proposalId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function accept() {
    if (!proposal) return;
    onApply(proposal.dinner_changes, proposal.shopping_additions, proposalId);
  }

  function reject() {
    onReject(proposalId);
  }

  return (
    <div>
      <h2 className="sheet-h2">Modify week</h2>
      <textarea
        className="txt"
        style={{ width: "100%", minHeight: 90, fontFamily: "inherit", fontSize: 14, padding: 10, borderRadius: 8 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's different? e.g. 'cleanse Mon–Wed' or 'busy week, all lazy'"
        disabled={loading}
        autoFocus
      />
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn-primary" onClick={submit} disabled={loading || !note.trim()}>
          {loading ? "Thinking…" : "Propose"}
        </button>
      </div>
      {error && <div className="hint" style={{ color: "var(--coral-ink, #c4452a)", marginTop: 8 }}>{error}</div>}
      {proposal && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e0d6)", paddingTop: 12 }}>
          <div className="note" style={{ marginBottom: 8 }}>{proposal.summary}</div>
          {(proposal.estimated_weekly_cost !== undefined || proposal.budget_status) && (
            <div
              className={"dash-budget-chip" + (proposal.budget_status === "over" ? " over" : "")}
              style={{ display: "inline-flex", marginBottom: 10, gap: 8 }}
            >
              <span className="dbc-val">
                ${proposal.estimated_weekly_cost ?? "?"}
                {proposal.budget_status === "over" && " · over"}
                {proposal.budget_status === "under" && " · under"}
                {proposal.budget_status === "at" && " · on target"}
              </span>
            </div>
          )}
          {proposal.scrounge_suggestion && (
            <div className="last-week-banner over" style={{ marginBottom: 12 }}>
              <i className="ti ti-alert-triangle" />
              <div><strong>Scrounge:</strong> {proposal.scrounge_suggestion}</div>
            </div>
          )}
          {proposal.dinner_changes.length > 0 && (
            <>
              <div className="sheet-h3">Changes</div>
              {proposal.dinner_changes.map((c) => (
                <div key={c.day} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="day-name" style={{ fontSize: 14 }}>{c.day}</span>
                    <span className={"day-tag t-" + (c.skip ? "skip" : c.tag)}>{c.skip ? "Skip" : c.label}</span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 2 }}>{c.skip ? (c.skipReason || "—") : (c.meal || "—")}</div>
                  {c.note && !c.skip && <div className="gf-mini">{c.note}</div>}
                </div>
              ))}
            </>
          )}
          {proposal.shopping_additions.length > 0 && (
            <>
              <div className="sheet-h3" style={{ marginTop: 12 }}>Shopping +{proposal.shopping_additions.length}</div>
              <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                {proposal.shopping_additions.map((a, i) => (
                  <div key={i}>+ {a.name} <span className="gf-mini" style={{ display: "inline" }}>→ {a.store}</span></div>
                ))}
              </div>
            </>
          )}
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={accept}>Apply</button>
            <button className="btn-ghost" onClick={reject}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Recipe import from URL (rendered inside a sheet) ---------- */
type ImportedRecipe = {
  title: string;
  source_summary: string;
  servings: string;
  prep_time: string;
  cook_time: string;
  ingredients: { item: string; amount: string; note: string }[];
  steps: string[];
  suggested_day: string;
  suggested_tag: string;
  suggested_label: string;
  shopping_additions: { name: string; store: string }[];
  family_fit_warnings: string;
};

function RecipeImport({
  onApply, onReject,
}: {
  onApply: (
    day: string,
    payload: { title: string; tag: string; label: string; steps: string[]; ingredients: { item: string; amount: string; note: string }[] },
    additions: { name: string; store: string }[],
    proposalId?: number,
  ) => void;
  onReject: (proposalId?: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<ImportedRecipe | null>(null);
  const [proposalId, setProposalId] = useState<number | undefined>(undefined);
  const [selectedDay, setSelectedDay] = useState<string>("");

  async function submit() {
    setError(null);
    setRecipe(null);
    setProposalId(undefined);
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "import_recipe", url: url.trim(), note: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setRecipe(data.proposal);
      setProposalId(data.proposalId);
      setSelectedDay(data.proposal?.suggested_day || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function accept() {
    if (!recipe || !selectedDay) return;
    onApply(
      selectedDay,
      {
        title: recipe.title,
        tag: recipe.suggested_tag,
        label: recipe.suggested_label,
        steps: recipe.steps,
        ingredients: recipe.ingredients,
      },
      recipe.shopping_additions,
      proposalId,
    );
  }

  function reject() {
    onReject(proposalId);
  }

  return (
    <div>
      <h2 className="sheet-h2">Import recipe</h2>
      <div className="add-row">
        <input
          className="txt"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Paste URL"
          disabled={loading}
          autoFocus
        />
        <button className="btn-primary" onClick={submit} disabled={loading || !url.trim()}>
          {loading ? "Reading…" : "Parse"}
        </button>
      </div>
      {error && <div className="hint" style={{ color: "var(--coral-ink, #c4452a)", marginTop: 8 }}>{error}</div>}
      {recipe && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e0d6)", paddingTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 17 }}>{recipe.title}</div>
          <div className="note" style={{ marginBottom: 10 }}>{recipe.source_summary}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>
            <span>🍽 {recipe.servings}</span>
            <span>⏱ {recipe.prep_time}</span>
            <span>🔥 {recipe.cook_time}</span>
            <span className={"day-tag t-" + recipe.suggested_tag}>{recipe.suggested_label}</span>
          </div>

          {recipe.family_fit_warnings && (
            <div className="last-week-banner over" style={{ marginBottom: 10 }}>
              <i className="ti ti-alert-triangle" />
              <div>{recipe.family_fit_warnings}</div>
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <div className="gf-mini" style={{ marginBottom: 4 }}>Slot into</div>
            <div className="ideas">
              {DAY_NAMES.map((day) => (
                <button
                  key={day}
                  className={"idea-chip" + (selectedDay === day ? " recipe-chip" : "")}
                  onClick={() => setSelectedDay(day)}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          <div className="sheet-h3">Ingredients ({recipe.ingredients.length})</div>
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {recipe.ingredients.map((ing, i) => (
              <li key={i}>
                <strong>{ing.amount}</strong> {ing.item}
                {ing.note && <span className="gf-mini" style={{ display: "inline", marginLeft: 6 }}>({ing.note})</span>}
              </li>
            ))}
          </ul>

          {recipe.shopping_additions.length > 0 && (
            <>
              <div className="sheet-h3" style={{ marginTop: 12 }}>Add to shopping ({recipe.shopping_additions.length})</div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                {recipe.shopping_additions.map((a, i) => (
                  <div key={i}>+ {a.name} <span className="gf-mini" style={{ display: "inline" }}>→ {a.store}</span></div>
                ))}
              </div>
            </>
          )}

          <div className="sheet-h3" style={{ marginTop: 12 }}>Steps ({recipe.steps.length})</div>
          <ol style={{ paddingLeft: 22, margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {recipe.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 3 }}>{s.replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "")}</li>
            ))}
          </ol>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn-primary" onClick={accept} disabled={!selectedDay}>
              {selectedDay ? `Apply → ${selectedDay}` : "Pick a day"}
            </button>
            <button className="btn-ghost" onClick={reject}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Plan shopping (build list from this week's dinners) ---------- */
type PlanShoppingAddition = { name: string; store: string; for_meal: string };
type PlanShoppingResult = {
  summary: string;
  shopping_additions: PlanShoppingAddition[];
  notes: string;
};

function PlanShoppingPanel({
  dinners, items, currentWeek, onApply, onReject,
}: {
  dinners: Dinner[];
  items: Item[];
  currentWeek: number;
  onApply: (additions: PlanShoppingAddition[], proposalId?: number) => void;
  onReject: (proposalId?: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanShoppingResult | null>(null);
  const [proposalId, setProposalId] = useState<number | undefined>(undefined);
  const [keep, setKeep] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let canceled = false;
    async function run() {
      setLoading(true);
      setError(null);
      let anchorStore = "";
      try { anchorStore = localStorage.getItem("fossofam-active-store") || ""; } catch {}
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "plan_shopping",
            note: "",
            dinners,
            items,
            currentWeek,
            anchorStore,
          }),
        });
        const data = await res.json();
        if (canceled) return;
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        const r = data.proposal as PlanShoppingResult;
        setResult(r);
        setProposalId(data.proposalId);
        const k: Record<number, boolean> = {};
        r.shopping_additions.forEach((_, i) => { k[i] = true; });
        setKeep(k);
      } catch (e) {
        if (!canceled) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    run();
    return () => { canceled = true; };
    // Intentionally run once on mount with the snapshot props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() {
    if (!result) return;
    const additions = result.shopping_additions.filter((_, i) => keep[i]);
    if (additions.length === 0) {
      onReject(proposalId);
      return;
    }
    onApply(additions, proposalId);
  }

  function reject() {
    onReject(proposalId);
  }

  return (
    <div>
      <h2 className="sheet-h2">Stock the week</h2>
      {loading && (
        <div className="note">Reading the dinner plan + your existing list…</div>
      )}
      {error && !loading && (
        <div className="hint" style={{ color: "var(--coral-ink, #c4452a)" }}>{error}</div>
      )}
      {result && !loading && (
        <>
          <div className="note" style={{ marginBottom: 10 }}>{result.summary}</div>
          {result.notes && (
            <div className="last-week-banner over" style={{ marginBottom: 12 }}>
              <i className="ti ti-info-circle" />
              <div>{result.notes}</div>
            </div>
          )}
          {result.shopping_additions.length === 0 ? (
            <div className="empty" style={{ padding: "14px 0" }}>You&apos;re already stocked for the week.</div>
          ) : (
            <>
              <div className="sheet-h3">Add ({Object.values(keep).filter(Boolean).length} of {result.shopping_additions.length})</div>
              {result.shopping_additions.map((a, i) => (
                <label key={i} className={"receipt-row" + (keep[i] ? "" : " off")}>
                  <input
                    type="checkbox"
                    checked={!!keep[i]}
                    onChange={() => setKeep((p) => ({ ...p, [i]: !p[i] }))}
                  />
                  <div className="rr-name">
                    {a.name}
                    <div className="rr-sub">→ {a.store} · for {a.for_meal}</div>
                  </div>
                </label>
              ))}
              <div className="toolbar" style={{ marginTop: 16 }}>
                <button className="btn-primary" onClick={apply}>
                  Add {Object.values(keep).filter(Boolean).length} to list
                </button>
                <button className="btn-ghost" onClick={reject}>Reject</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Overflow sheet (post-trip "send leftovers to next store") ---------- */
function OverflowSheet({
  items, fromStoreName, currentStoreKey, onSendTo, onSkip, onCancel,
}: {
  items: Item[];
  fromStoreName: string;
  currentStoreKey: string;
  onSendTo: (storeKey: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <h2 className="sheet-h2">{items.length} left at {fromStoreName}</h2>
      <div className="note" style={{ marginBottom: 12 }}>Where do you want to grab these?</div>

      <div className="overflow-items">
        {items.map((i) => (
          <div key={i.id} className="overflow-item">{i.name}</div>
        ))}
      </div>

      <div className="sheet-h3" style={{ marginTop: 16 }}>Send to</div>
      <div className="ideas">
        {STORE_ORDER
          .filter((k) => k !== currentStoreKey && k !== "online")
          .map((k) => (
            <button key={k} className="idea-chip" onClick={() => onSendTo(k)}>
              {STORE[k].name}
            </button>
          ))}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={onSkip}>Skip these</button>
        <button className="btn-ghost" onClick={onCancel}>Decide later</button>
      </div>
    </div>
  );
}

/* ---------- Receipt diff sheet ---------- */
function ReceiptSheet({
  state, onToggleMatched, onToggleReceiptOnly, onApply, onCancel,
}: {
  state: {
    loading: boolean;
    error: string | null;
    receipt: Receipt | null;
    matchedKeep: Record<number, boolean>;
    receiptOnlyKeep: Record<number, boolean>;
  };
  onToggleMatched: (itemId: number) => void;
  onToggleReceiptOnly: (idx: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  if (state.loading) {
    return (
      <div>
        <h2 className="sheet-h2">Reading receipt…</h2>
        <div className="note">Compressing + parsing the photo. Usually 5-10 seconds.</div>
      </div>
    );
  }
  if (state.error) {
    return (
      <div>
        <h2 className="sheet-h2">Couldn&apos;t read the receipt</h2>
        <div className="hint" style={{ color: "var(--coral-ink, #c4452a)" }}>{state.error}</div>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <button className="btn-ghost" onClick={onCancel}>Close</button>
        </div>
      </div>
    );
  }
  const r = state.receipt;
  if (!r) return null;

  const updatesTotal = r.matched
    .filter((m) => state.matchedKeep[m.item_id])
    .reduce((s, m) => s + m.price_on_receipt, 0);
  const addsTotal = r.receipt_only
    .filter((_, i) => state.receiptOnlyKeep[i])
    .reduce((s, ro) => s + ro.price, 0);
  const computedTotal = updatesTotal + addsTotal;
  const diffFromReceipt = computedTotal - r.total;

  return (
    <div>
      <h2 className="sheet-h2">{r.store === "unknown" || !r.store ? "Receipt" : r.store}</h2>
      <div className="receipt-summary">
        <div className="rs-block">
          <div className="rs-label">Receipt total</div>
          <div className="rs-val">${r.total.toFixed(2)}</div>
        </div>
        <div className="rs-block">
          <div className="rs-label">Will log as</div>
          <div className="rs-val rs-will">${r.total.toFixed(2)}</div>
        </div>
        {Math.abs(diffFromReceipt) > 0.5 && (
          <div className="rs-block rs-warn">
            <div className="rs-label">Items vs total</div>
            <div className="rs-val">{diffFromReceipt > 0 ? "+" : "−"}${Math.abs(diffFromReceipt).toFixed(2)}</div>
          </div>
        )}
      </div>

      {r.notes && (
        <div className="last-week-banner over" style={{ marginBottom: 14 }}>
          <i className="ti ti-info-circle" />
          <div>{r.notes}</div>
        </div>
      )}

      {r.matched.length > 0 && (
        <>
          <div className="sheet-h3">Matched ({r.matched.length}) — prices update</div>
          {r.matched.map((m) => {
            const keep = state.matchedKeep[m.item_id];
            const priceChanged = m.price_in_cart != null && Math.abs(m.price_on_receipt - m.price_in_cart) > 0.5;
            return (
              <label key={m.item_id} className={"receipt-row" + (keep ? "" : " off")}>
                <input
                  type="checkbox"
                  checked={!!keep}
                  onChange={() => onToggleMatched(m.item_id)}
                />
                <div className="rr-name">
                  {m.cart_name}
                  {m.receipt_name && m.receipt_name.toLowerCase() !== m.cart_name.toLowerCase() && (
                    <div className="rr-sub">on receipt: {m.receipt_name}</div>
                  )}
                </div>
                <div className="rr-price">
                  {priceChanged && m.price_in_cart != null && (
                    <span className="rr-old">${m.price_in_cart.toFixed(2)} →</span>
                  )}
                  <span className={priceChanged ? "rr-new" : ""}>${m.price_on_receipt.toFixed(2)}</span>
                </div>
              </label>
            );
          })}
        </>
      )}

      {r.receipt_only.length > 0 && (
        <>
          <div className="sheet-h3" style={{ marginTop: 14 }}>On receipt, not in cart ({r.receipt_only.length}) — add</div>
          {r.receipt_only.map((ro, i) => {
            const keep = state.receiptOnlyKeep[i];
            return (
              <label key={i} className={"receipt-row" + (keep ? "" : " off")}>
                <input
                  type="checkbox"
                  checked={!!keep}
                  onChange={() => onToggleReceiptOnly(i)}
                />
                <div className="rr-name">
                  {ro.receipt_name}
                  <div className="rr-sub">→ {ro.suggested_store}</div>
                </div>
                <div className="rr-price">
                  <span className="rr-new">${ro.price.toFixed(2)}</span>
                </div>
              </label>
            );
          })}
        </>
      )}

      {r.cart_only.length > 0 && (
        <>
          <div className="sheet-h3" style={{ marginTop: 14 }}>In cart, not on receipt ({r.cart_only.length})</div>
          <div className="note" style={{ marginBottom: 6 }}>Probably for a different store. Left as-is.</div>
          {r.cart_only.map((co) => (
            <div key={co.item_id} className="receipt-row dim">
              <div style={{ width: 22 }} />
              <div className="rr-name">
                {co.cart_name}
                {co.cart_price != null && <div className="rr-sub">listed at ${co.cart_price.toFixed(2)}</div>}
              </div>
              <div className="rr-price rr-old">—</div>
            </div>
          ))}
        </>
      )}

      <div className="toolbar" style={{ marginTop: 18 }}>
        <button className="btn-primary" onClick={onApply}>
          Apply &amp; log ${r.total.toFixed(2)}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
