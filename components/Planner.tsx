"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import type { Item, Dinner, Expense, Household } from "@/db/schema";
import {
  STORE, STORE_ORDER, ROUTE_PLAN, STAPLES, WEEKLY_TARGET,
  LAZY_IDEAS, MEDIUM_IDEAS, CROCK_IDEAS,
  routeStore,
} from "@/lib/data";
import {
  addItem, toggleItem, deleteItem, clearCheckedItems,
  updateDinnerMeal, updateDinnerSlot, setDinnerSkip,
  addExpense, deleteExpense, setCurrentWeek, closeOutWeek, clearLastWeek,
  getAllState, applyPlanChanges, rejectProposal, applyImportedRecipe,
} from "@/app/actions";

type Props = {
  initialItems: Item[];
  initialDinners: Dinner[];
  initialExpenses: Expense[];
  initialHousehold: Household;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// One-tap skip reasons. Tapping a chip skips the day with that reason — no
// prompt(). "Other…" falls back to a freeform input for less common cases.
const SKIP_REASONS = [
  "Ate out",
  "Family's house",
  "Leftovers",
  "Date night",
  "Don't feel like it",
  "Potluck",
];

// Swap-picker tiers. Tapping a chip replaces the day's meal with that text
// and sets the tag/label automatically. Pulled from lib/data.ts idea banks
// so adding a new idea there immediately shows up here.
const SWAP_OPTIONS: { tag: string; label: string; tier: string; ideas: readonly string[] }[] = [
  { tag: "lazy",  label: "Lazy",      tier: "Lazy (<5min)",   ideas: LAZY_IDEAS },
  { tag: "cook",  label: "Real cook", tier: "Real cook",       ideas: MEDIUM_IDEAS },
  { tag: "crock", label: "Crock pot", tier: "Crock pot",       ideas: CROCK_IDEAS },
];

function weekOfLabel() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  return monday.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

// Map "Sunday".."Saturday" to the actual Date in the current calendar week
// (Sunday → Saturday). Used to render dates next to each day row and to
// highlight today.
function datesForCurrentWeek(now: Date = new Date()): Record<string, Date> {
  const day = now.getDay(); // 0 = Sunday
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

function tagToKind(tag: string) {
  if (tag === "crock") return "crock";
  if (tag === "lazy") return "lazy";
  return "dinner";
}

function cycleLabel(week: number) {
  if (week === 3) return "bulk week";
  if (week === 2) return "feed week";
  return "normal week";
}

// Recipe shape returned by the /api/agent get_recipe tool.
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

  // Live two-phone sync — refetch on focus + every 20s while visible.
  // Paused while a transition is in flight to protect optimistic updates,
  // and paused while the tab is hidden to save battery.
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

  // ---- mutations (optimistic + persist) ----
  function doAddItem(name: string, store: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = store === "auto" ? routeStore(trimmed) : store;
    const temp: Item = { id: Date.now(), name: trimmed, store: s, done: false, createdAt: new Date() };
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
  function doAdvanceWeek() {
    const w = household.currentWeek === 3 ? 1 : household.currentWeek + 1;
    setHousehold((p) => ({ ...p, currentWeek: w }));
    startTransition(() => setCurrentWeek(w));
  }
  function doCloseWeek() {
    const weekly = expenses.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
    if (weekly === 0 && !confirm("No weekly expenses logged yet. Close out anyway?")) return;
    if (!confirm(`Snapshot this week's $${Math.round(weekly)} as last week and clear for a fresh week?`)) return;
    setHousehold((p) => ({ ...p, lastWeekTotal: weekly }));
    setExpenses([]);
    setDinners((p) => p.map((d) => ({ ...d, skip: false, skipReason: "" })));
    startTransition(() => closeOutWeek());
  }
  function doClearLastWeek() {
    setHousehold((p) => ({ ...p, lastWeekTotal: null }));
    startTransition(() => clearLastWeek());
  }

  // Recipe sheet state. Tapping 📖 recipe opens this; the request fires
  // against /api/agent (get_recipe tool). Rendered as a modal overlay.
  const [recipeSheet, setRecipeSheet] = useState<{
    open: boolean;
    meal: string;
    kind: string;
    loading: boolean;
    error: string | null;
    recipe: Recipe | null;
  }>({ open: false, meal: "", kind: "dinner", loading: false, error: null, recipe: null });

  async function getRecipe(meal: string, kind: string) {
    if (!meal.trim()) return;
    setRecipeSheet({ open: true, meal, kind, loading: true, error: null, recipe: null });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_recipe", note: "", meal, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setRecipeSheet((s) => ({ ...s, loading: false, recipe: data.proposal }));
    } catch (e) {
      setRecipeSheet((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Unknown error" }));
    }
  }

  function closeRecipeSheet() {
    setRecipeSheet({ open: false, meal: "", kind: "dinner", loading: false, error: null, recipe: null });
  }

  // Per-row menu state. One menu open at a time across the whole week list.
  // `type === "skip"` shows the reason chips; `type === "swap"` shows the idea picker.
  const [rowMenu, setRowMenu] = useState<{ dinnerId: number; type: "skip" | "swap" } | null>(null);
  function toggleRowMenu(dinnerId: number, type: "skip" | "swap") {
    setRowMenu((m) => (m && m.dinnerId === dinnerId && m.type === type ? null : { dinnerId, type }));
  }
  function applySkipReason(d: Dinner, reason: string) {
    doSkip(d.id, true, reason);
    setRowMenu(null);
  }
  function applySwap(d: Dinner, idea: string, tag: string, label: string) {
    setDinners((p) => p.map((x) => (x.id === d.id ? { ...x, meal: idea, tag, label } : x)));
    startTransition(() => updateDinnerSlot(d.id, { meal: idea, tag, label }));
    setRowMenu(null);
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
      {recipeSheet.open && (
        <RecipeSheet
          meal={recipeSheet.meal}
          loading={recipeSheet.loading}
          error={recipeSheet.error}
          recipe={recipeSheet.recipe}
          onClose={closeRecipeSheet}
        />
      )}
      <header className="top">
        <div>
          <h1>FossoFam</h1>
        </div>
      </header>

      {/* ============ TONIGHT + TOMORROW ============ */}
      <section className="card">
        <div className="dash-card-head"><i className="ti ti-flame" /><h2>Tonight · {todayName}</h2></div>
        <DinnerSpotlight d={today} prominent onSkip={(d) => toggleRowMenu(d.id, "skip")} onUnskip={() => doSkip(today.id, false, "")} getRecipe={getRecipe} />
        <div className="dash-card-head" style={{ marginTop: 18 }}><i className="ti ti-calendar" /><h2 style={{ fontSize: 16 }}>Tomorrow · {tomorrowName}</h2></div>
        <DinnerSpotlight d={tomorrow} prominent={false} onSkip={(d) => toggleRowMenu(d.id, "skip")} onUnskip={() => doSkip(tomorrow.id, false, "")} getRecipe={getRecipe} />
      </section>

      {/* ============ AI MODIFY WEEK ============ */}
      <AiModifyWeek
        dinners={dinners}
        items={items}
        currentWeek={currentWeek}
        onApply={(changes, additions, proposalId) => {
          // optimistic merge: apply dinner changes locally, append shopping additions
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
              createdAt: new Date(),
            })),
          ]);
          startTransition(() => applyPlanChanges(changes, additions, proposalId));
        }}
        onReject={(proposalId) => {
          if (proposalId !== undefined) startTransition(() => rejectProposal(proposalId));
        }}
      />

      {/* ============ IMPORT RECIPE FROM URL ============ */}
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
              createdAt: new Date(),
            })),
          ]);
          startTransition(() => applyImportedRecipe(day, payload, additions, proposalId));
        }}
        onReject={(proposalId) => {
          if (proposalId !== undefined) startTransition(() => rejectProposal(proposalId));
        }}
      />

      {/* ============ THIS WEEK ============ */}
      <section className="card">
        <h2>Week of {weekOfLabel()}</h2>
        <div className="note">Edit any meal inline. Tap ↺ to swap, ✕ to skip a day.</div>
        <div>
          {dinners.map((d) => {
            const skipOpen = rowMenu?.dinnerId === d.id && rowMenu.type === "skip";
            const swapOpen = rowMenu?.dinnerId === d.id && rowMenu.type === "swap";
            const dateForDay = weekDates[d.day];
            const isToday = dateForDay ? isSameYMD(dateForDay, todayDate) : false;
            const dateLabel = dateForDay
              ? dateForDay.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "";
            return (
              <div key={d.id}>
                <div
                  className={"day-row" + (d.skip ? " skipped" : "")}
                  style={isToday ? { background: "rgba(36, 110, 110, 0.06)", borderRadius: 8 } : undefined}
                >
                  <div>
                    <div className="day-name">
                      {d.day}
                      {dateLabel && <span style={{ fontWeight: 400, color: "var(--ink-3)", marginLeft: 6, fontSize: 13 }}>· {dateLabel}</span>}
                      {isToday && <span className="day-tag t-cook" style={{ marginLeft: 8, fontSize: 10, verticalAlign: "middle" }}>today</span>}
                    </div>
                    <span className={"day-tag t-" + (d.skip ? "skip" : d.tag)}>{d.skip ? "Skipped" : d.label}</span>
                  </div>
                  {d.skip ? (
                    <div><div className="skip-reason">{d.skipReason || "No dinner needed"}</div></div>
                  ) : (
                    <div>
                      <input
                        className="meal-input"
                        defaultValue={d.meal}
                        onBlur={(e) => { if (e.target.value !== d.meal) doUpdateMeal(d.id, e.target.value); }}
                      />
                      {d.note && <div className="gf-mini">{d.note}</div>}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {d.skip ? (
                      <button className="swap-btn" onClick={() => doSkip(d.id, false, "")}>↩ un-skip</button>
                    ) : (
                      <>
                        <button className="swap-btn recipe-btn" onClick={() => getRecipe(d.meal, tagToKind(d.tag))}>📖 recipe</button>
                        <button className={"swap-btn" + (swapOpen ? " recipe-btn" : "")} onClick={() => toggleRowMenu(d.id, "swap")}>↺ swap</button>
                        <button className={"swap-btn skip-btn"} onClick={() => toggleRowMenu(d.id, "skip")}>✕ skip</button>
                      </>
                    )}
                  </div>
                </div>
                {skipOpen && (
                  <div style={{ padding: "8px 12px 14px", borderBottom: "1px solid var(--line, #e5e0d6)" }}>
                    <div className="gf-mini" style={{ marginBottom: 6 }}>Why skip {d.day}?</div>
                    <div className="ideas">
                      {SKIP_REASONS.map((r) => (
                        <button key={r} className="idea-chip" onClick={() => applySkipReason(d, r)}>{r}</button>
                      ))}
                      <button className="idea-chip" onClick={() => skipOther(d)}>Other…</button>
                    </div>
                  </div>
                )}
                {swapOpen && (
                  <div style={{ padding: "8px 12px 14px", borderBottom: "1px solid var(--line, #e5e0d6)" }}>
                    <div className="gf-mini" style={{ marginBottom: 6 }}>Swap {d.day} for…</div>
                    {SWAP_OPTIONS.map((group) => (
                      <div key={group.tier} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-3)", margin: "4px 0" }}>{group.tier}</div>
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

      {/* ============ SHOPPING ============ */}
      <ShoppingSection
        items={items}
        active={active}
        itemsByStore={itemsByStore}
        onlineActive={onlineActive}
        onAddItem={doAddItem}
        onToggle={doToggle}
        onDelete={doDelete}
        onClearChecked={doClearChecked}
      />

      {/* ============ BUDGET ============ */}
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
        onCloseWeek={doCloseWeek}
        onClearLastWeek={doClearLastWeek}
      />
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
        <span className="dash-tom-tag t-skip">{d.day} · Skipped</span>
        <div className="dash-tom-note">{d.skipReason} — enjoy the night off.</div>
        <button className="swap-btn" style={{ marginTop: 10 }} onClick={onUnskip}>↩ un-skip</button>
      </div>
    );
  }
  return (
    <div>
      <div className="dash-tom-meal" style={{ fontSize: prominent ? 22 : 16 }}>{d.meal || "—"}</div>
      <span className={"dash-tom-tag t-" + d.tag}>{d.day} · {d.label}</span>
      {d.note && <div className="dash-tom-note">{d.note}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="swap-btn recipe-btn" onClick={() => getRecipe(d.meal, tagToKind(d.tag))}>📖 get recipe ↗</button>
        <button className="swap-btn skip-btn" onClick={() => onSkip(d)}>✕ skip a day</button>
      </div>
    </div>
  );
}

/* ---------- Shopping ---------- */
function ShoppingSection({
  items, active, itemsByStore, onlineActive,
  onAddItem, onToggle, onDelete, onClearChecked,
}: {
  items: Item[];
  active: Item[];
  itemsByStore: { key: string; store: typeof STORE[string]; target: number; fallback: string | null; items: Item[] }[];
  onlineActive: Item[];
  onAddItem: (name: string, store: string) => void;
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
  onClearChecked: () => void;
}) {
  const [val, setVal] = useState("");
  function submit() {
    if (!val.trim()) return;
    onAddItem(val, "auto");
    setVal("");
  }
  return (
    <section className="card">
      <h2>Shopping</h2>
      <div className="add-row">
        <input
          className="txt"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Type it and hit add — auto-routes to the right store…"
        />
        <button className="btn-primary" onClick={submit}>Add</button>
      </div>
      <div className="dash-quickadd">
        {STAPLES.slice(0, 10).map((s) => (
          <button key={s} className="idea-chip" onClick={() => onAddItem(s, "auto")}>+ {s}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">Nothing on the list — you&apos;re all stocked.</div>
      ) : (
        <>
          {itemsByStore.filter((g) => g.key !== "online").map((g) => {
            const remaining = g.items.filter((i) => !i.done).length;
            return (
              <div className="store-group" key={g.key}>
                <div className="store-head">
                  <span className="store-name">
                    <span className="store-swatch" style={{ background: g.store.color }} />
                    {g.store.name}
                  </span>
                  <span className="store-meta">{remaining} to get</span>
                </div>
                {g.items.map((it) => (
                  <div className={"item" + (it.done ? " done" : "")} key={it.id}>
                    <input type="checkbox" checked={it.done} onChange={(e) => onToggle(it.id, e.target.checked)} />
                    <span className="item-name">{it.name}</span>
                    <span className="item-x" onClick={() => onDelete(it.id)}>×</span>
                  </div>
                ))}
                {g.fallback && remaining > 0 && (
                  <div className="gf-mini" style={{ marginTop: 6 }}>
                    ↳ if missing, get at {STORE[g.fallback].name}
                  </div>
                )}
              </div>
            );
          })}
          {onlineActive.length > 0 && (
            <div className="dash-online-cta">
              <i className="ti ti-world" />
              <div className="txt-wrap">
                <div className="oc-title">Place an online order</div>
                <div className="oc-items">{onlineActive.map((i) => i.name).join(" · ")}</div>
              </div>
              <button onClick={() => {
                const t = `Help me place an online order for these items (we like glass packaging, organic, mold-free coffee): ${onlineActive.map((i) => i.name).join(", ")}. Suggest where to buy each and rough prices.`;
                navigator.clipboard?.writeText(t).catch(() => {});
                alert("Order request copied to clipboard — paste into Claude:\n\n" + t);
              }}>Draft order ↗</button>
            </div>
          )}
          <div className="toolbar">
            <button className="btn-ghost" onClick={onClearChecked}>Clear checked</button>
            <button className="btn-ghost" onClick={() => window.print()}>Print list</button>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- Budget ---------- */
function BudgetSection({
  expenses, weeklySpent, bulkSpent, remain, pct, over, household, currentWeek,
  onAddExpense, onDeleteExpense, onCloseWeek, onClearLastWeek,
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
  onCloseWeek: () => void;
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
      <h2>Budget</h2>
      {household.lastWeekTotal !== null && (
        household.lastWeekTotal <= WEEKLY_TARGET ? (
          <div className="last-week-banner good">
            <i className="ti ti-check" />
            <div>Last week: <strong>${Math.round(household.lastWeekTotal)}</strong> — nice work, {Math.round(WEEKLY_TARGET - household.lastWeekTotal) > 0 ? `$${Math.round(WEEKLY_TARGET - household.lastWeekTotal)} under` : "right on"} target! 🎉</div>
            <span className="lw-reset" onClick={onClearLastWeek}>clear</span>
          </div>
        ) : (
          <div className="last-week-banner over">
            <i className="ti ti-info-circle" />
            <div>Last week: <strong>${Math.round(household.lastWeekTotal)}</strong> — ${Math.round(household.lastWeekTotal - WEEKLY_TARGET)} over. Fresh start this week.</div>
            <span className="lw-reset" onClick={onClearLastWeek}>clear</span>
          </div>
        )
      )}
      <div className="metrics" style={{ marginBottom: 12 }}>
        <div className="metric"><div className="label">Target</div><div className="val">${WEEKLY_TARGET}</div></div>
        <div className="metric"><div className="label">Spent</div><div className="val">${Math.round(weeklySpent)}</div></div>
        <div className="metric"><div className="label">Remaining</div><div className={"val " + (over ? "over" : "ok")}>${Math.round(remain)}</div></div>
      </div>
      <div className="bar-track"><div className={"bar-fill" + (weeklySpent > WEEKLY_TARGET ? " over" : weeklySpent > WEEKLY_TARGET * 0.85 ? " warn" : "")} style={{ width: pct + "%" }} /></div>
      {bulkSpent > 0 && <div className="hint">Plus ${Math.round(bulkSpent)} in the bulk envelope (separate from weekly).</div>}

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
        <div className="empty" style={{ marginTop: 10 }}>No runs logged this week yet.</div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {expenses.map((e) => (
            <div className="budget-line" key={e.id}>
              <div className="bl-name">{e.name}<small>{e.kind === "bulk" ? "bulk envelope" : "weekly"}</small></div>
              <div style={{ textAlign: "right", fontSize: 14 }}>${Math.round(e.amount)}</div>
              <div className="bl-store"><span className="item-x" style={{ opacity: 1, cursor: "pointer" }} onClick={() => onDeleteExpense(e.id)}>remove</span></div>
            </div>
          ))}
        </div>
      )}
      <div className="toolbar">
        <button className="btn-ghost" onClick={onCloseWeek}>Close out week &amp; start fresh</button>
      </div>
    </section>
  );
}

/* ---------- Recipe sheet ---------- */
function RecipeSheet({
  meal, loading, error, recipe, onClose,
}: {
  meal: string;
  loading: boolean;
  error: string | null;
  recipe: Recipe | null;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20, 18, 14, 0.55)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg, #faf8f3)",
          maxWidth: 640, width: "100%",
          maxHeight: "90vh", overflowY: "auto",
          borderRadius: "16px 16px 8px 8px",
          padding: "20px 22px 28px",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div className="dash-tom-tag t-cook" style={{ fontSize: 11 }}>Recipe</div>
          <button
            className="btn-ghost"
            onClick={onClose}
            style={{ padding: "4px 10px", fontSize: 14 }}
          >
            Close ✕
          </button>
        </div>

        {loading && (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>Writing recipe for</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{meal}</div>
            <div className="note" style={{ marginTop: 12 }}>Sized for the family · GF · DF-aware…</div>
          </div>
        )}

        {error && !loading && (
          <div style={{ padding: "16px 0" }}>
            <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 6 }}>Couldn&apos;t generate</div>
            <div className="hint" style={{ color: "var(--coral-ink, #c4452a)" }}>{error}</div>
          </div>
        )}

        {recipe && !loading && (
          <>
            <h2 style={{ marginTop: 0, fontSize: 22, lineHeight: 1.25 }}>{recipe.title}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", margin: "8px 0 14px", fontSize: 13, color: "var(--ink-2)" }}>
              <span>🍽 {recipe.servings}</span>
              <span>⏱ {recipe.prep_time} prep</span>
              <span>🔥 {recipe.cook_time}</span>
            </div>

            {recipe.when_to_start && (
              <div className="last-week-banner good" style={{ marginBottom: 14 }}>
                <i className="ti ti-clock" />
                <div><strong>Start by:</strong> {recipe.when_to_start}</div>
              </div>
            )}

            <h3 style={{ fontSize: 14, fontWeight: 500, margin: "16px 0 6px", textTransform: "uppercase", letterSpacing: 0.3, color: "var(--ink-2)" }}>
              Ingredients
            </h3>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>
                  <strong>{ing.amount}</strong> {ing.item}
                  {ing.note && <span className="gf-mini" style={{ display: "inline", marginLeft: 6 }}>({ing.note})</span>}
                </li>
              ))}
            </ul>

            <h3 style={{ fontSize: 14, fontWeight: 500, margin: "20px 0 6px", textTransform: "uppercase", letterSpacing: 0.3, color: "var(--ink-2)" }}>
              Steps
            </h3>
            <ol style={{ paddingLeft: 22, margin: 0, fontSize: 14, lineHeight: 1.8 }}>
              {recipe.steps.map((s, i) => (
                // Strip any leading "1." / "1)" / "Step 1." prefix the model may
                // emit, since the <ol> already numbers each step.
                <li key={i} style={{ marginBottom: 4 }}>{s.replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "")}</li>
              ))}
            </ol>

            {recipe.tips.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 500, margin: "20px 0 6px", textTransform: "uppercase", letterSpacing: 0.3, color: "var(--ink-2)" }}>
                  Tips
                </h3>
                <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
                  {recipe.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- AI modify-week ---------- */
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
    setProposal(null);
    setProposalId(undefined);
    setNote("");
  }

  function reject() {
    onReject(proposalId);
    setProposal(null);
    setProposalId(undefined);
  }

  return (
    <section className="card">
      <div className="dash-card-head"><i className="ti ti-sparkles" /><h2>Tell the AI about this week</h2></div>
      <textarea
        className="txt"
        style={{ width: "100%", minHeight: 80, marginTop: 4, fontFamily: "inherit", fontSize: 14, padding: 8, borderRadius: 6 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's different? e.g. '3-day cleanse Mon–Wed, normal Thu–Sat' or 'busy week, all lazy meals'"
        disabled={loading}
      />
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn-primary" onClick={submit} disabled={loading || !note.trim()}>
          {loading ? "Thinking…" : "Get proposal"}
        </button>
        {(note || proposal || error) && (
          <button className="btn-ghost" onClick={() => { setNote(""); setError(null); setProposal(null); setProposalId(undefined); }}>Clear</button>
        )}
      </div>
          {error && <div className="hint" style={{ color: "var(--coral-ink, #c4452a)", marginTop: 8 }}>Error: {error}</div>}
          {proposal && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e0d6)", paddingTop: 12 }}>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Proposal</div>
              <div className="note" style={{ marginBottom: 8 }}>{proposal.summary}</div>
              {(proposal.estimated_weekly_cost !== undefined || proposal.budget_status) && (
                <div
                  className={"dash-budget-chip" + (proposal.budget_status === "over" ? " over" : "")}
                  style={{ display: "inline-flex", marginBottom: 10, gap: 8 }}
                >
                  <span className="dbc-label">Est. week:</span>
                  <span className="dbc-val">
                    ${proposal.estimated_weekly_cost ?? "?"}
                    {proposal.budget_status === "over" && " — over"}
                    {proposal.budget_status === "under" && " — under"}
                    {proposal.budget_status === "at" && " — on target"}
                  </span>
                </div>
              )}
              {proposal.scrounge_suggestion && (
                <div className="last-week-banner over" style={{ marginBottom: 12 }}>
                  <i className="ti ti-alert-triangle" />
                  <div><strong>Scrounge night:</strong> {proposal.scrounge_suggestion}</div>
                </div>
              )}
              {proposal.dinner_changes.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 500, margin: "8px 0 4px" }}>Dinner changes ({proposal.dinner_changes.length})</div>
                  {proposal.dinner_changes.map((c) => (
                    <div key={c.day} className="day-row" style={{ padding: "8px 0" }}>
                      <div>
                        <div className="day-name">{c.day}</div>
                        <span className={"day-tag t-" + (c.skip ? "skip" : c.tag)}>{c.skip ? "Skipped" : c.label}</span>
                      </div>
                      <div>
                        <div style={{ fontSize: 14 }}>{c.skip ? (c.skipReason || "No dinner needed") : (c.meal || "—")}</div>
                        {c.note && !c.skip && <div className="gf-mini">{c.note}</div>}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {proposal.shopping_additions.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 500, margin: "12px 0 4px" }}>Shopping additions ({proposal.shopping_additions.length})</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                    {proposal.shopping_additions.map((a, i) => (
                      <div key={i}>+ {a.name} <span className="gf-mini" style={{ display: "inline" }}>→ {a.store}</span></div>
                    ))}
                  </div>
                </>
              )}
              <div className="toolbar" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={accept}>Apply changes</button>
                <button className="btn-ghost" onClick={reject}>Reject</button>
              </div>
            </div>
          )}
    </section>
  );
}

/* ---------- Recipe import from URL ---------- */
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
  const [open, setOpen] = useState(false);
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
    setRecipe(null);
    setUrl("");
    setOpen(false);
  }

  function reject() {
    onReject(proposalId);
    setRecipe(null);
    setProposalId(undefined);
  }

  return (
    <section className="card">
      <div className="dash-card-head"><i className="ti ti-link" /><h2>Import a recipe from a URL</h2></div>
      {!open ? (
        <>
          <div className="note">Paste a recipe link → we parse it, suggest a day to slot it into, and queue the missing ingredients on your shopping list. Approve before anything saves.</div>
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Paste a link ↗</button>
        </>
      ) : (
        <>
          <div className="add-row">
            <input
              className="txt"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="https://… (paste recipe URL)"
              disabled={loading}
            />
            <button className="btn-primary" onClick={submit} disabled={loading || !url.trim()}>
              {loading ? "Reading…" : "Parse"}
            </button>
            <button className="btn-ghost" onClick={() => { setOpen(false); setUrl(""); setRecipe(null); setError(null); }}>Cancel</button>
          </div>
          {error && <div className="hint" style={{ color: "var(--coral-ink, #c4452a)", marginTop: 8 }}>Error: {error}</div>}
          {recipe && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #e5e0d6)", paddingTop: 12 }}>
              <div style={{ fontWeight: 500, marginBottom: 4, fontSize: 17 }}>{recipe.title}</div>
              <div className="note" style={{ marginBottom: 10 }}>{recipe.source_summary}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>
                <span>🍽 {recipe.servings}</span>
                <span>⏱ {recipe.prep_time} prep</span>
                <span>🔥 {recipe.cook_time}</span>
                <span className={"day-tag t-" + recipe.suggested_tag} style={{ marginLeft: 0 }}>{recipe.suggested_label}</span>
              </div>

              {recipe.family_fit_warnings && (
                <div className="last-week-banner over" style={{ marginBottom: 10 }}>
                  <i className="ti ti-alert-triangle" />
                  <div><strong>Heads up:</strong> {recipe.family_fit_warnings}</div>
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <div className="gf-mini" style={{ marginBottom: 4 }}>Slot into which day?</div>
                <div className="ideas">
                  {DAY_NAMES.map((day) => (
                    <button
                      key={day}
                      className={"idea-chip" + (selectedDay === day ? " recipe-chip" : "")}
                      onClick={() => setSelectedDay(day)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: 13, fontWeight: 500, margin: "10px 0 4px", textTransform: "uppercase", letterSpacing: 0.3, color: "var(--ink-2)" }}>
                Ingredients ({recipe.ingredients.length})
              </div>
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
                  <div style={{ fontSize: 13, fontWeight: 500, margin: "12px 0 4px", textTransform: "uppercase", letterSpacing: 0.3, color: "var(--ink-2)" }}>
                    Will add to shopping ({recipe.shopping_additions.length})
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                    {recipe.shopping_additions.map((a, i) => (
                      <div key={i}>+ {a.name} <span className="gf-mini" style={{ display: "inline" }}>→ {a.store}</span></div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontSize: 13, fontWeight: 500, margin: "12px 0 4px", textTransform: "uppercase", letterSpacing: 0.3, color: "var(--ink-2)" }}>
                Steps ({recipe.steps.length})
              </div>
              <ol style={{ paddingLeft: 22, margin: 0, fontSize: 13, lineHeight: 1.7 }}>
                {recipe.steps.map((s, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{s.replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "")}</li>
                ))}
              </ol>

              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="btn-primary" onClick={accept} disabled={!selectedDay}>
                  {selectedDay ? `Apply to ${selectedDay}` : "Pick a day first"}
                </button>
                <button className="btn-ghost" onClick={reject}>Reject</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
