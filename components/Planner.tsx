"use client";

import { useState, useTransition } from "react";
import type { Item, Dinner, Expense, Household } from "@/db/schema";
import {
  STORE, STORE_ORDER, ROUTE_PLAN, STAPLES,
  LAZY_IDEAS, MEDIUM_IDEAS, CROCK_IDEAS, BAKING_IDEAS, WEEKS, WEEKLY_TARGET,
} from "@/lib/data";
import {
  addItem, toggleItem, deleteItem, clearCheckedItems,
  updateDinnerMeal, setDinnerSkip,
  addExpense, setCurrentWeek, closeOutWeek, clearLastWeek,
} from "@/app/actions";

type Props = {
  initialItems: Item[];
  initialDinners: Dinner[];
  initialExpenses: Expense[];
  initialHousehold: Household;
};

const TABS = [
  { id: "dash", label: "Dashboard" },
  { id: "dinners", label: "Dinner rotation" },
  { id: "outof", label: "Out of / need" },
  { id: "shop", label: "Shop & budget" },
  { id: "route", label: "Store route" },
  { id: "cycle", label: "3-week cycle" },
];

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
  const [tab, setTab] = useState("dash");
  const [items, setItems] = useState(initialItems);
  const [dinners, setDinners] = useState(initialDinners);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [household, setHousehold] = useState(initialHousehold);
  const [, startTransition] = useTransition();

  const currentWeek = household.currentWeek;
  const active = items.filter((i) => !i.done);

  // ---- helpers that optimistically update + persist ----
  function doAddItem(name: string, store: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = store === "auto" ? routeStoreClient(trimmed) : store;
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
    const temp: Expense = { id: Date.now(), name: name || "Expense", amount, kind, createdAt: new Date() };
    setExpenses((p) => [...p, temp]);
    startTransition(() => addExpense(name, amount, kind));
  }
  function doSetWeek(w: number) {
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

  // ---- derived budget ----
  const weeklySpent = expenses.filter((e) => e.kind !== "bulk").reduce((s, e) => s + e.amount, 0);
  const bulkSpent = expenses.filter((e) => e.kind === "bulk").reduce((s, e) => s + e.amount, 0);
  const remain = WEEKLY_TARGET - weeklySpent;

  // ---- route ----
  const counts: Record<string, number> = {};
  active.forEach((i) => { counts[i.store] = (counts[i.store] || 0) + 1; });
  const stops = ROUTE_PLAN.filter((s) => counts[s.key] > 0);

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Fosso Meal Planner</h1>
          <div className="sub">Gluten-free · potato-loving · organic · no-plastic · low-waste</div>
        </div>
        <div className="cycle-pill">Week {currentWeek} of 3 · {currentWeek === 3 ? "bulk week" : currentWeek === 2 ? "feed week" : "normal week"}</div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "outof" && (
              <span className={"dot" + (active.length === 0 ? " zero" : "")}>{active.length}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "dash" && (
        <Dashboard
          dinners={dinners} active={active} stops={stops} counts={counts}
          weeklySpent={weeklySpent} bulkSpent={bulkSpent} remain={remain}
          household={household} currentWeek={currentWeek} expenseCount={expenses.length}
          onAddItem={doAddItem} onAddExpense={doAddExpense} onClearLastWeek={doClearLastWeek}
          getRecipe={getRecipe} goTab={setTab}
        />
      )}
      {tab === "dinners" && (
        <Dinners dinners={dinners} onUpdateMeal={doUpdateMeal} onSkip={doSkip} getRecipe={getRecipe} />
      )}
      {tab === "outof" && (
        <OutOf items={items} onAdd={doAddItem} onToggle={doToggle} onDelete={doDelete} />
      )}
      {tab === "shop" && (
        <ShopBudget
          items={items} expenses={expenses} weeklySpent={weeklySpent} bulkSpent={bulkSpent}
          remain={remain} currentWeek={currentWeek}
          onAddExpense={doAddExpense} onToggle={doToggle} onDelete={doDelete}
          onClearChecked={doClearChecked} onCloseWeek={doCloseWeek}
        />
      )}
      {tab === "route" && <Route stops={stops} counts={counts} active={active} />}
      {tab === "cycle" && <Cycle currentWeek={currentWeek} onSetWeek={doSetWeek} />}
    </div>
  );
}

// client-side mirror of routeStore (so optimistic add picks the same store)
function routeStoreClient(name: string): string {
  const R: [RegExp, string][] = [
    [/coffee.*mold|mold.*coffee|sprouts coffee/i, "sprouts"],
    [/decaf|bible study coffee/i, "grocout"],
    [/snack|cookie|pie crust|baking|flour|sugar|brown sugar|chocolate chip|brownie|muffin|vanilla|cinnamon|apple.*pie|crisp/i, "grocout"],
    [/raw milk.*2 gallon|2 gallon.*raw|raw milk pickup/i, "rawmilk"],
    [/raw milk|raw\.milk/i, "coop"],
    [/myshan|grocery outlet milk|non\.?raw milk/i, "grocout"],
    [/coconut milk|organic.*chicken|pasture|chuck roast|organic protein|grass.fed/i, "fred"],
    [/feed|chicken feed|coastal/i, "coastal"],
    [/paper towel|olipop|zevia|bulk|toilet|big bag|case of/i, "costco"],
    [/flower|bouquet/i, "tj"],
    [/glass|online|order/i, "online"],
  ];
  for (const [re, s] of R) if (re.test(name)) return s;
  return "fred";
}

/* ===================== DASHBOARD ===================== */
function Dashboard(props: any) {
  const {
    dinners, active, stops, counts, weeklySpent, remain, household,
    currentWeek, expenseCount, onAddItem, onAddExpense, onClearLastWeek, getRecipe, goTab,
  } = props;

  const [outVal, setOutVal] = useState("");
  const [qeName, setQeName] = useState("");
  const [qeAmt, setQeAmt] = useState("");

  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const tName = names[(new Date().getDay() + 1) % 7];
  const td = dinners.find((d: Dinner) => d.day === tName) || dinners[0];

  const onlineItems = active.filter((i: Item) => i.store === "online").map((i: Item) => i.name);
  const pct = Math.min(100, Math.round((weeklySpent / WEEKLY_TARGET) * 100));
  const over = remain < 0;

  return (
    <section className="panel active">
      <div className="dash-hero">
        <div>
          <div className="dash-week">Week of {weekOfLabel()}</div>
          <div className="dash-cycle">Week {currentWeek} of 3 · {currentWeek === 3 ? "bulk week" : currentWeek === 2 ? "feed week" : "normal week"}</div>
        </div>
        <div className={"dash-budget-chip" + (over ? " over" : "")}>
          <span className="dbc-label">Left this week</span>
          <span className="dbc-val">${Math.round(remain)}</span>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card dash-card">
          <div className="dash-card-head"><i className="ti ti-map-pin" /><h2>Where to go next</h2></div>
          {stops.length === 0 ? (
            <div className="empty-dash">Nothing to buy right now. Add items below as you run low.</div>
          ) : (
            <div className="dash-next">
              <span className="swatch" style={{ background: STORE[stops[0].key].color }} />
              <div>
                <div className="nm">{STORE[stops[0].key].name}</div>
                <div className="meta">
                  {counts[stops[0].key]} item{counts[stops[0].key] > 1 ? "s" : ""} · aim ~${stops[0].target}
                  {stops.length > 1 ? ` · then ${stops.length - 1} more stop${stops.length - 1 > 1 ? "s" : ""}` : ""}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card dash-card">
          <div className="dash-card-head"><i className="ti ti-calendar" /><h2>Tomorrow&apos;s dinner</h2></div>
          {td.skip ? (
            <>
              <div className="dash-tom-meal" style={{ color: "var(--ink-3)" }}>No dinner needed</div>
              <span className="dash-tom-tag t-skip">{td.day} · Skipped</span>
              <div className="dash-tom-note">{td.skipReason} — enjoy the night off.</div>
            </>
          ) : (
            <>
              <div className="dash-tom-meal">{td.meal || "—"}</div>
              <span className={"dash-tom-tag t-" + td.tag}>{td.day} · {td.label}</span>
              {td.note && <div className="dash-tom-note">{td.note}</div>}
              <button className="swap-btn recipe-btn" onClick={() => getRecipe(td.meal, tagToKind(td.tag))}>📖 get recipe ↗</button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="dash-card-head"><i className="ti ti-plus" /><h2>Anything else you&apos;re out of?</h2></div>
        <div className="add-row" style={{ marginBottom: 6 }}>
          <input className="txt" value={outVal} onChange={(e) => setOutVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onAddItem(outVal, "auto"); setOutVal(""); } }}
            placeholder="Type it and hit add — it routes to the right store…" />
          <button className="btn-primary" onClick={() => { onAddItem(outVal, "auto"); setOutVal(""); }}>Add</button>
        </div>
        <div className="dash-quickadd">
          {STAPLES.slice(0, 10).map((s) => (
            <button key={s} className="idea-chip" onClick={() => onAddItem(s, "auto")}>+ {s}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="dash-card-head"><i className="ti ti-shopping-cart" /><h2>What to get &amp; where</h2></div>
        {active.length === 0 ? (
          <div className="dash-summary"><span style={{ fontStyle: "italic", color: "var(--ink-3)" }}>List is empty — you&apos;re all stocked.</span></div>
        ) : (
          <>
            <div className="dash-summary">
              <strong>{active.length} item{active.length > 1 ? "s" : ""}</strong> across <strong>{stops.length} store{stops.length > 1 ? "s" : ""}</strong>. Hit them in order:
            </div>
            {stops.filter((s: any) => s.key !== "online").map((s: any) => {
              const list = active.filter((i: Item) => i.store === s.key).map((i: Item) => i.name);
              return (
                <div className="dash-store-block" key={s.key}>
                  <div className="dash-store-title">
                    <span className="swatch" style={{ background: STORE[s.key].color }} />
                    {STORE[s.key].name}
                    <span className="cnt">{list.length} item{list.length > 1 ? "s" : ""} · ~${s.target}</span>
                  </div>
                  <div className="dash-store-items">{list.join(" · ")}</div>
                </div>
              );
            })}
            {onlineItems.length > 0 && (
              <div className="dash-online-cta">
                <i className="ti ti-world" />
                <div className="txt-wrap">
                  <div className="oc-title">Place an online order</div>
                  <div className="oc-items">{onlineItems.join(" · ")}</div>
                </div>
                <button onClick={() => {
                  const t = `Help me place an online order for these items (we like glass packaging, organic, mold-free coffee): ${onlineItems.join(", ")}. Suggest where to buy each and rough prices.`;
                  navigator.clipboard?.writeText(t).catch(() => {});
                  alert("Order request copied to clipboard — paste into Claude:\n\n" + t);
                }}>Draft order ↗</button>
              </div>
            )}
          </>
        )}
        <div className="toolbar">
          <button className="btn-ghost" onClick={() => goTab("route")}>Full route ↗</button>
          <button className="btn-ghost" onClick={() => window.print()}>Print list</button>
        </div>
      </div>

      <div className="card">
        <div className="dash-card-head"><i className="ti ti-wallet" /><h2>Budget at a glance</h2></div>
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
          <div className="metric"><div className="label">Weekly target</div><div className="val">${WEEKLY_TARGET}</div></div>
          <div className="metric"><div className="label">Spent / planned</div><div className="val">${Math.round(weeklySpent)}</div></div>
          <div className="metric"><div className="label">Remaining</div><div className={"val " + (over ? "over" : "ok")}>${Math.round(remain)}</div></div>
        </div>
        <div className="bar-track"><div className={"bar-fill" + (weeklySpent > WEEKLY_TARGET ? " over" : weeklySpent > WEEKLY_TARGET * 0.85 ? " warn" : "")} style={{ width: pct + "%" }} /></div>
        <div className="hint">{expenseCount === 0 ? "Log store totals on the Shop & budget tab to track the week." : `${expenseCount} run${expenseCount > 1 ? "s" : ""} logged.`}</div>
        <div className="quick-expense">
          <span className="qe-label">Quick add expense</span>
          <input className="txt qe-name" value={qeName} onChange={(e) => setQeName(e.target.value)} placeholder="Store / what for" />
          <input className="txt qe-amt" type="number" min="0" step="1" value={qeAmt} onChange={(e) => setQeAmt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onAddExpense(qeName, parseFloat(qeAmt) || 0, "weekly"); setQeName(""); setQeAmt(""); } }} placeholder="$" />
          <button className="btn-primary" onClick={() => { onAddExpense(qeName, parseFloat(qeAmt) || 0, "weekly"); setQeName(""); setQeAmt(""); }}>Add</button>
        </div>
      </div>
    </section>
  );
}

/* ===================== DINNERS ===================== */
function Dinners({ dinners, onUpdateMeal, onSkip, getRecipe }: any) {
  return (
    <section className="panel active">
      <div className="card">
        <h2>This week&apos;s dinners</h2>
        <div className="note">Simple-ish variety, mostly easy. Edit any meal, tap 📖 recipe to generate one, or ✕ skip a day when you&apos;re eating out or have leftovers.</div>
        <div>
          {dinners.map((d: Dinner) => (
            <div className={"day-row" + (d.skip ? " skipped" : "")} key={d.id}>
              <div>
                <div className="day-name">{d.day}</div>
                <span className={"day-tag t-" + (d.skip ? "skip" : d.tag)}>{d.skip ? "Skipped" : d.label}</span>
              </div>
              {d.skip ? (
                <div><div className="skip-reason">{d.skipReason || "No dinner needed"}</div></div>
              ) : (
                <div>
                  <input className="meal-input" defaultValue={d.meal}
                    onBlur={(e) => { if (e.target.value !== d.meal) onUpdateMeal(d.id, e.target.value); }} />
                  {d.note && <div className="gf-mini">{d.note}</div>}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {d.skip ? (
                  <button className="swap-btn" onClick={() => onSkip(d.id, false, "")}>↩ un-skip</button>
                ) : (
                  <>
                    <button className="swap-btn recipe-btn" onClick={() => getRecipe(d.meal, tagToKind(d.tag))}>📖 recipe ↗</button>
                    <button className="swap-btn skip-btn" onClick={() => {
                      const r = prompt(`Skip ${d.day} — reason? (leftovers, invited out, date night, etc.)`, "Leftovers");
                      if (r === null) return;
                      onSkip(d.id, true, r.trim() || "No dinner needed");
                    }}>✕ skip day</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--teal)" }} />Crock pot</span>
          <span><i style={{ background: "var(--amber)" }} />Lazy / 15-min</span>
          <span><i style={{ background: "var(--coral)" }} />Real cook</span>
          <span><i style={{ background: "var(--ink-3)" }} />Leftovers</span>
          <span><i style={{ background: "var(--blue)" }} />Flex / wildcard</span>
        </div>
      </div>

      <IdeaBank title="Idea bank by effort" getRecipe={getRecipe} />

      <div className="card">
        <h2>Baking &amp; treats</h2>
        <div className="note">Bake here and there — doubles for Bible study or your own treats. Tap 📖 for a full recipe, sized to share.</div>
        <div className="ideas">
          {BAKING_IDEAS.map((b) => (
            <span className="chip-group" key={b}>
              <button className="idea-chip" onClick={() => getRecipe(b, "bake")}>{b}</button>
              <button className="idea-chip recipe-chip" onClick={() => getRecipe(b, "bake")}>📖</button>
            </span>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 10 }}><strong>Pairs well with study nights:</strong> a Dutch apple pie or cookie batch covers Thursday&apos;s group and leaves treats for the week.</div>
      </div>

      <div className="card">
        <h2>Everyone-else meals</h2>
        <div style={{ fontSize: 14, lineHeight: 1.9 }}>
          <strong>Knute:</strong> protein powder + yogurt, mackerel/tuna tin, or leftovers. High-protein only.<br />
          <strong>Kait:</strong> fresh or leftovers — GF/DF tuna plate or turkey roll-ups.<br />
          <strong>Girls:</strong> grilled cheese, ½ goodles mac box, half-sandwiches, banana + book at night.<br />
          <strong>Girls breakfast:</strong> Dutch baby ~1×/week, otherwise boiled eggs + fruit, oatmeal, yogurt.
        </div>
      </div>
    </section>
  );
}

function IdeaBank({ title, getRecipe }: any) {
  const banks = [
    { label: "Lazy · <5 min, minimal dishes", color: "var(--amber-ink)", list: LAZY_IDEAS, kind: "lazy" },
    { label: "Medium · some prep", color: "var(--coral-ink)", list: MEDIUM_IDEAS, kind: "dinner" },
    { label: "Crock pot · set & forget", color: "var(--teal-ink)", list: CROCK_IDEAS, kind: "crock" },
  ];
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="note">Tap 📖 to generate a full recipe in chat, scaled for your family and GF/DF-aware.</div>
      {banks.map((b) => (
        <div key={b.label}>
          <div style={{ fontSize: 13, fontWeight: 600, color: b.color, margin: "12px 0 7px" }}>{b.label}</div>
          <div className="ideas">
            {b.list.map((idea) => (
              <span className="chip-group" key={idea}>
                <button className="idea-chip" onClick={() => getRecipe(idea, b.kind)}>{idea}</button>
                <button className="idea-chip recipe-chip" onClick={() => getRecipe(idea, b.kind)}>📖</button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===================== OUT OF ===================== */
function OutOf({ items, onAdd, onToggle, onDelete }: any) {
  const [val, setVal] = useState("");
  const [store, setStore] = useState("auto");
  return (
    <section className="panel active">
      <div className="card">
        <h2>What are we out of?</h2>
        <div className="note">Add anything the moment you notice it&apos;s low. It flows straight into the right store list. You and Kait both see the same list.</div>
        <div className="add-row">
          <input className="txt" value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onAdd(val, store); setVal(""); } }}
            placeholder="e.g. coconut milk, paper towels, chuck roast…" />
          <select value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="auto">Best store (auto)</option>
            {STORE_ORDER.map((k) => <option key={k} value={k}>{STORE[k].name}</option>)}
          </select>
          <button className="btn-primary" onClick={() => { onAdd(val, store); setVal(""); }}>Add</button>
        </div>
        {items.length === 0 ? (
          <div className="empty">Nothing on the list yet — add items as you run low.</div>
        ) : (
          items.map((it: Item) => (
            <div className={"item" + (it.done ? " done" : "")} key={it.id}>
              <input type="checkbox" checked={it.done} onChange={(e) => onToggle(it.id, e.target.checked)} />
              <span className="item-name">{it.name}</span>
              <span className="item-cat">{STORE[it.store].short}</span>
              <span className="item-x" onClick={() => onDelete(it.id)}>×</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>Tap-to-add staples</h2>
        <div className="note">Your must-haves and repeat buys. One tap adds to the running list.</div>
        <div className="staples-grid">
          {STAPLES.map((s) => (
            <div className="staple" key={s} onClick={() => onAdd(s, "auto")}>
              <i className="ti ti-plus" />{s}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===================== SHOP & BUDGET ===================== */
function ShopBudget({ items, expenses, weeklySpent, bulkSpent, remain, onAddExpense, onToggle, onDelete, onClearChecked, onCloseWeek }: any) {
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const [kind, setKind] = useState("weekly");
  const pct = Math.min(100, Math.round((weeklySpent / WEEKLY_TARGET) * 100));
  const over = remain < 0;

  return (
    <section className="panel active">
      <div className="card">
        <h2>This week&apos;s budget</h2>
        <div className="metrics">
          <div className="metric"><div className="label">Weekly target</div><div className="val">${WEEKLY_TARGET}</div></div>
          <div className="metric"><div className="label">Spent / planned</div><div className="val">${Math.round(weeklySpent)}</div></div>
          <div className="metric"><div className="label">Remaining</div><div className={"val " + (over ? "over" : "ok")}>${Math.round(remain)}</div></div>
        </div>
        <div className="bar-track"><div className={"bar-fill" + (weeklySpent > WEEKLY_TARGET ? " over" : weeklySpent > WEEKLY_TARGET * 0.85 ? " warn" : "")} style={{ width: pct + "%" }} /></div>
        <div className="hint">Type each store run&apos;s total. Weekly runs count against the ${WEEKLY_TARGET}; bulk runs sit in their own envelope.</div>

        <div style={{ marginTop: 18 }}>
          <div className="add-row">
            <input className="txt" value={name} onChange={(e) => setName(e.target.value)} placeholder="Run name (e.g. Fred Meyer pickup)" />
            <input className="txt" type="number" min="0" step="1" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="$ total" style={{ maxWidth: 120, minWidth: 90 }}
              onKeyDown={(e) => { if (e.key === "Enter") { onAddExpense(name, parseFloat(amt) || 0, kind); setName(""); setAmt(""); } }} />
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="weekly">Weekly (${WEEKLY_TARGET})</option>
              <option value="bulk">Bulk ($200)</option>
            </select>
            <button className="btn-primary" onClick={() => { onAddExpense(name, parseFloat(amt) || 0, kind); setName(""); setAmt(""); }}>Add total</button>
          </div>
          <div>
            {expenses.length === 0 ? (
              <div className="empty">No runs logged yet — add a store total above.</div>
            ) : expenses.map((e: Expense) => (
              <div className="budget-line" key={e.id}>
                <div className="bl-name">{e.name}<small>{e.kind === "bulk" ? "bulk envelope" : "weekly"}</small></div>
                <div style={{ textAlign: "right", fontSize: 14 }}>${Math.round(e.amount)}</div>
                <div className="bl-store"><span className="item-x" style={{ opacity: 1, cursor: "pointer" }} onClick={() => onDelete(e.id)}>remove</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="total-row">
          <span className="tl">Weekly grocery total</span>
          <span className="tv">${Math.round(weeklySpent + bulkSpent)}{bulkSpent ? ` (incl. $${Math.round(bulkSpent)} bulk)` : ""}</span>
        </div>
        <div className="toolbar">
          <button className="btn-ghost" onClick={onCloseWeek}>Close out week &amp; start fresh</button>
        </div>
      </div>

      <div className="card">
        <h2>Shopping list by store</h2>
        <div className="note">Everything from your list, sorted to the cheapest sensible store. Check off as you go.</div>
        {items.length === 0 ? (
          <div className="empty">Add items on the &quot;Out of / need&quot; tab and they&apos;ll sort into stores here.</div>
        ) : (
          STORE_ORDER.map((sk) => {
            const list = items.filter((i: Item) => i.store === sk);
            if (list.length === 0) return null;
            const remaining = list.filter((i: Item) => !i.done).length;
            return (
              <div className="store-group" key={sk}>
                <div className="store-head">
                  <span className="store-name"><span className="store-swatch" style={{ background: STORE[sk].color }} />{STORE[sk].name}</span>
                  <span className="store-meta">{remaining} to get</span>
                </div>
                {list.map((it: Item) => (
                  <div className={"item" + (it.done ? " done" : "")} key={it.id}>
                    <input type="checkbox" checked={it.done} onChange={(e) => onToggle(it.id, e.target.checked)} />
                    <span className="item-name">{it.name}</span>
                    <span className="item-x" onClick={() => onDelete(it.id)}>×</span>
                  </div>
                ))}
              </div>
            );
          })
        )}
        <div className="toolbar">
          <button className="btn-ghost" onClick={onClearChecked}>Clear checked items</button>
          <button className="btn-ghost" onClick={() => window.print()}>Print / export</button>
        </div>
      </div>
    </section>
  );
}

/* ===================== ROUTE ===================== */
function Route({ stops, counts, active }: any) {
  const totalItems = stops.reduce((s: number, x: any) => s + counts[x.key], 0);
  const totalTarget = stops.reduce((s: number, x: any) => s + x.target, 0);
  const perItem = totalItems ? (totalTarget / totalItems).toFixed(0) : "0";

  return (
    <section className="panel active">
      <div className="card">
        <h2>Suggested store order</h2>
        <div className="note">Built from your current list. Hit stops in order, aim for each target, and anything missing rolls to the fallback store.</div>
        <div className="metrics">
          <div className="metric"><div className="label">Stops this run</div><div className="val">{stops.length}</div></div>
          <div className="metric"><div className="label">Items to get</div><div className="val">{totalItems}</div></div>
          <div className="metric"><div className="label">Target spend</div><div className="val">${totalTarget}</div></div>
        </div>
        {stops.length === 0 ? (
          <div className="empty">Add items on the &quot;Out of / need&quot; tab and a route will build itself here.</div>
        ) : (
          <>
            {stops.map((s: any, idx: number) => {
              const n = counts[s.key];
              const list = active.filter((i: Item) => i.store === s.key).map((i: Item) => i.name);
              const avg = (s.target / n).toFixed(0);
              return (
                <div className="week-card" key={s.key}>
                  <div className="week-head">
                    <span className="week-title"><span className="store-swatch" style={{ background: STORE[s.key].color, display: "inline-block", marginRight: 7 }} />{idx + 1}. {STORE[s.key].name}</span>
                    <span className="week-budget">aim ~${s.target} · {n} item{n > 1 ? "s" : ""}</span>
                  </div>
                  <div className="gf-mini" style={{ marginBottom: 6 }}>{s.tip} <strong>~${avg}/item avg.</strong></div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>{list.join(" · ")}</div>
                  {s.fallback && <div className="wtag normal" style={{ marginTop: 8, display: "inline-block" }}>↳ if missing, get at {STORE[s.fallback].name}</div>}
                </div>
              );
            })}
            <div className="hint">
              That&apos;s <strong>{totalItems} items</strong> across <strong>{stops.length} stops</strong>, target <strong>${totalTarget}</strong> (~${perItem}/item).{" "}
              {totalTarget > WEEKLY_TARGET ? "Above $215 — trim the list, lean on Grocery Outlet finds, or tag a stop as bulk." : "Comfortably under the $215 weekly target."}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Store cheat-sheet</h2>
        <div style={{ fontSize: 13.5, lineHeight: 1.95 }}>
          <strong style={{ color: "var(--blue-ink)" }}>Fred Meyer</strong> — pickup + sale items. Default weekly run.<br />
          <strong style={{ color: "var(--green-ink)" }}>Co-op</strong> — raw milk source.<br />
          <strong style={{ color: "var(--green-ink)" }}>Grocery Outlet</strong> — deals + snacks + decaf. MyShan milk (non-raw) fallback.<br />
          <strong style={{ color: "var(--pink-ink, #993556)" }}>Raw milk pickup</strong> — 2 gallons @ $10 each.<br />
          <strong style={{ color: "var(--teal-ink)" }}>Sprouts</strong> (Mill Creek) — mold-free coffee + organic on a south trip.<br />
          <strong style={{ color: "var(--coral-ink)" }}>Costco</strong> — bulk only, Week 3.<br />
          <strong style={{ color: "var(--amber-ink)" }}>Trader Joe&apos;s</strong> — flowers + event needs.<br />
          <strong style={{ color: "var(--ink-2)" }}>Coastal</strong> — chicken feed, ~monthly.<br />
          <strong style={{ color: "var(--ink-2)" }}>Online</strong> — coffee backup, glass/pantry restocks.
        </div>
      </div>
    </section>
  );
}

/* ===================== CYCLE ===================== */
function Cycle({ currentWeek, onSetWeek }: any) {
  return (
    <section className="panel active">
      <div className="card">
        <h2>Your 3-week rhythm</h2>
        <div className="note">Big trips are spread out so they never gang up on one week. Tap a week to make it current.</div>
        {WEEKS.map((w) => (
          <div className={"week-card" + (w.n === currentWeek ? " active-week" : "")} key={w.n} onClick={() => onSetWeek(w.n)} style={{ cursor: "pointer" }}>
            <div className="week-head">
              <span className="week-title">Week {w.n} {w.n === currentWeek && <span className="now-badge">current</span>}</span>
              <span className="week-budget">{w.budget}</span>
            </div>
            <div className="week-tags">
              {w.tags.map(([cls, txt]) => <span className={"wtag " + cls} key={txt}>{txt}</span>)}
            </div>
            <div className="gf-mini" style={{ marginTop: 8 }}>{w.desc}</div>
          </div>
        ))}
        <div className="hint">
          <strong>Why this shape:</strong> Costco/bulk (~$200) lands on Week 3 only, so Weeks 1&amp;2 stay lean on the $215. Coastal chicken feed (~monthly) is parked on Week 2. Once hens lay in August, the egg line drops and absorbs the feed — roughly a wash.
        </div>
      </div>
    </section>
  );
}
