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
  const [sheet, setSheet] = useState<"ai" | "import" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [staplesOpen, setStaplesOpen] = useState(false);

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

  // Recipe sheet (opened from the 📖 action on any dinner)
  const [recipeSheetState, setRecipeSheetState] = useState<{
    open: boolean;
    meal: string;
    kind: string;
    loading: boolean;
    error: string | null;
    recipe: Recipe | null;
  }>({ open: false, meal: "", kind: "dinner", loading: false, error: null, recipe: null });

  async function getRecipe(meal: string, kind: string) {
    if (!meal.trim()) return;
    setRecipeSheetState({ open: true, meal, kind, loading: true, error: null, recipe: null });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_recipe", note: "", meal, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setRecipeSheetState((s) => ({ ...s, loading: false, recipe: data.proposal }));
    } catch (e) {
      setRecipeSheetState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Unknown error" }));
    }
  }

  function closeRecipeSheet() {
    setRecipeSheetState({ open: false, meal: "", kind: "dinner", loading: false, error: null, recipe: null });
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
          onClose={closeRecipeSheet}
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

      {/* ============ TONIGHT + TOMORROW ============ */}
      <section className="card">
        <div className="dash-card-head"><i className="ti ti-flame" /><h2>Tonight · {todayName}</h2></div>
        <DinnerSpotlight d={today} prominent onSkip={(d) => toggleRowMenu(d.id, "skip")} onUnskip={() => doSkip(today.id, false, "")} getRecipe={getRecipe} />
        <div className="dash-card-head" style={{ marginTop: 18 }}><i className="ti ti-calendar" /><h2 style={{ fontSize: 16 }}>Tomorrow · {tomorrowName}</h2></div>
        <DinnerSpotlight d={tomorrow} prominent={false} onSkip={(d) => toggleRowMenu(d.id, "skip")} onUnskip={() => doSkip(tomorrow.id, false, "")} getRecipe={getRecipe} />
      </section>

      {/* ============ THIS WEEK ============ */}
      <section className="card">
        <h2>Week of {weekOfLabel()}</h2>
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
        staplesOpen={staplesOpen}
        setStaplesOpen={setStaplesOpen}
      />

      {/* ============ BUDGET STRIP ============ */}
      <div className="budget-strip" onClick={() => setBudgetOpen((v) => !v)}>
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>${Math.round(weeklySpent)}</span>
        <span style={{ color: "var(--ink-3)" }}>of ${WEEKLY_TARGET}</span>
        <span style={{ color: "var(--ink-3)" }}>·</span>
        <span className={over ? "over" : "ok"}>{over ? `$${Math.abs(Math.round(remain))} over` : `$${Math.round(remain)} left`}</span>
        <span className="caret">{budgetOpen ? "▾" : "▸"}</span>
      </div>
      {budgetOpen && (
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
function ShoppingSection({
  items, active, itemsByStore, onlineActive,
  onAddItem, onToggle, onDelete, onClearChecked,
  staplesOpen, setStaplesOpen,
}: {
  items: Item[];
  active: Item[];
  itemsByStore: { key: string; store: typeof STORE[string]; target: number; fallback: string | null; items: Item[] }[];
  onlineActive: Item[];
  onAddItem: (name: string, store: string) => void;
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
  onClearChecked: () => void;
  staplesOpen: boolean;
  setStaplesOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
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

      {items.length === 0 ? (
        <div className="empty" style={{ marginTop: 8 }}>All stocked.</div>
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
                  <span className="store-meta">{remaining}</span>
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
                    ↳ {STORE[g.fallback].name}
                  </div>
                )}
              </div>
            );
          })}
          {onlineActive.length > 0 && (
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
          <div className="toolbar">
            <button className="btn-ghost" onClick={onClearChecked}>Clear checked</button>
          </div>
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
  meal, loading, error, recipe, onClose,
}: {
  meal: string;
  loading: boolean;
  error: string | null;
  recipe: Recipe | null;
  onClose: () => void;
}) {
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

            <h3 className="sheet-h3">Ingredients</h3>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>
                  <strong>{ing.amount}</strong> {ing.item}
                  {ing.note && <span className="gf-mini" style={{ display: "inline", marginLeft: 6 }}>({ing.note})</span>}
                </li>
              ))}
            </ul>

            <h3 className="sheet-h3">Steps</h3>
            <ol style={{ paddingLeft: 22, margin: 0, fontSize: 14, lineHeight: 1.8 }}>
              {recipe.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{s.replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, "")}</li>
              ))}
            </ol>

            {recipe.tips.length > 0 && (
              <>
                <h3 className="sheet-h3">Tips</h3>
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
