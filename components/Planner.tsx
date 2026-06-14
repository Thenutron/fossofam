"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import type { Item, Dinner, Expense, Household } from "@/db/schema";
import {
  STORE, STORE_ORDER, ROUTE_PLAN, STAPLES, WEEKLY_TARGET,
  routeStore,
} from "@/lib/data";
import {
  addItem, toggleItem, deleteItem, clearCheckedItems,
  updateDinnerMeal, setDinnerSkip,
  addExpense, deleteExpense, setCurrentWeek, closeOutWeek, clearLastWeek,
  getAllState,
} from "@/app/actions";

type Props = {
  initialItems: Item[];
  initialDinners: Dinner[];
  initialExpenses: Expense[];
  initialHousehold: Household;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekOfLabel() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  return monday.toLocaleDateString(undefined, { month: "long", day: "numeric" });
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

const FAM = "Family context: gluten-free household (sometimes dairy-free too); 2 adults + 2 young girls who eat small portions (the girls aren't GF/DF but want healthy). We love potatoes. Organic where it matters.";

function recipePrompt(meal: string, kind: string) {
  if (kind === "bake")
    return `Give me a recipe for ${meal}. ${FAM} It's for Bible study night and/or our own treats, so a batch size that shares well is great. Note where to buy specialty items cheap (we use Grocery Outlet for baking + snacks). Make it gluten-free if reasonable, or note a GF swap.`;
  if (kind === "lazy")
    return `Give me a genuinely lazy recipe for ${meal} — under 5 minutes of prep and minimal dishes. ${FAM} List ingredients, then quick steps. Flag any easy dairy-free swap for the adults.`;
  if (kind === "crock")
    return `Give me a crock pot recipe for ${meal} sized to leave leftovers for next-day lunches. ${FAM} List ingredients and simple steps, and tell me when to start it.`;
  return `Give me a simple recipe for ${meal}. ${FAM} Keep it weeknight-easy with minimal cleanup. List ingredients then steps, and flag a dairy-free swap for the adults where it matters.`;
}

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
    const temp: Expense = { id: Date.now(), name: name || "Expense", amount, kind, createdAt: new Date() };
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

  function getRecipe(meal: string, kind: string) {
    if (!meal.trim()) return;
    const text = recipePrompt(meal, kind);
    navigator.clipboard?.writeText(text).catch(() => {});
    alert("Recipe request copied to your clipboard — paste it into Claude (or your favorite assistant):\n\n" + text);
  }

  function skipPrompt(d: Dinner) {
    const r = prompt(`Skip ${d.day} — reason? (leftovers, invited out, date night, etc.)`, "Leftovers");
    if (r === null) return;
    doSkip(d.id, true, r.trim() || "No dinner needed");
  }

  // ---- derived ----
  const currentWeek = household.currentWeek;
  const active = items.filter((i) => !i.done);
  const weeklySpent = expenses.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
  const bulkSpent = expenses.filter((e) => e.kind === "bulk").reduce((s, e) => s + e.amount, 0);
  const remain = WEEKLY_TARGET - weeklySpent;
  const pct = Math.min(100, Math.round((weeklySpent / WEEKLY_TARGET) * 100));
  const over = remain < 0;

  const todayIdx = new Date().getDay();
  const todayName = DAY_NAMES[todayIdx];
  const tomorrowName = DAY_NAMES[(todayIdx + 1) % 7];
  const today = dinners.find((d) => d.day === todayName) ?? dinners[0];
  const tomorrow = dinners.find((d) => d.day === tomorrowName) ?? dinners[0];

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
      <header className="top">
        <div>
          <h1>Fosso Meal Planner</h1>
          <div className="sub">Gluten-free · potato-loving · organic · no-plastic · low-waste</div>
        </div>
        <button
          type="button"
          className="cycle-pill"
          onClick={doAdvanceWeek}
          title="Tap to move to the next week"
          style={{ cursor: "pointer", border: "none", font: "inherit" }}
        >
          Week {currentWeek} of 3 · {cycleLabel(currentWeek)}
        </button>
      </header>

      {/* ============ TONIGHT + TOMORROW ============ */}
      <section className="card">
        <div className="dash-card-head"><i className="ti ti-flame" /><h2>Tonight · {todayName}</h2></div>
        <DinnerSpotlight d={today} prominent onSkip={skipPrompt} onUnskip={() => doSkip(today.id, false, "")} getRecipe={getRecipe} />
        <div className="dash-card-head" style={{ marginTop: 18 }}><i className="ti ti-calendar" /><h2 style={{ fontSize: 16 }}>Tomorrow · {tomorrowName}</h2></div>
        <DinnerSpotlight d={tomorrow} prominent={false} onSkip={skipPrompt} onUnskip={() => doSkip(tomorrow.id, false, "")} getRecipe={getRecipe} />
      </section>

      {/* ============ THIS WEEK ============ */}
      <section className="card">
        <h2>This week</h2>
        <div className="note">Edit any meal inline. Skip a day if you have leftovers, a potluck, or plans out. {weekOfLabel()} →</div>
        <div>
          {dinners.map((d) => (
            <div className={"day-row" + (d.skip ? " skipped" : "")} key={d.id}>
              <div>
                <div className="day-name">{d.day}</div>
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
                    <button className="swap-btn recipe-btn" onClick={() => getRecipe(d.meal, tagToKind(d.tag))}>📖 recipe ↗</button>
                    <button className="swap-btn skip-btn" onClick={() => skipPrompt(d)}>✕ skip</button>
                  </>
                )}
              </div>
            </div>
          ))}
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
                  <span className="store-meta">{remaining} to get · aim ~${g.target}</span>
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
