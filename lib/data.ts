// ---- Stores ----
// `note` is the family's actual lived-in take on each store — what it's good
// for, what its tradeoff is. This text feeds the agent's system prompt so
// proposals respect convenience vs cost vs availability per-store.
export const STORE: Record<string, { name: string; color: string; short: string; note: string }> = {
  grocout: { name: "Grocery Outlet", color: "#639922", short: "Groc. Outlet",
             note: "Cheapest finds (snacks, baking, decaf, MyShan non-raw milk). Stock is inconsistent — can't count on getting everything. Whatever's missing rolls to Fred Meyer or Target." },
  fred:    { name: "Fred Meyer",     color: "#378add", short: "Fred Meyer",
             note: "Reliable catch-all + convenient pickup. Good when low on time — but higher average cost per item. Use it for what Grocery Outlet didn't have." },
  target:  { name: "Target",         color: "#cc0000", short: "Target",
             note: "Same shape as Fred Meyer — convenient pickup, higher cost per item. Use when Target's closer or has a specific thing." },
  coop:    { name: "Co-op",          color: "#1d9e75", short: "Co-op",
             note: "Raw milk source (when getting fresh raw milk, not from the dedicated pickup spot)." },
  sprouts: { name: "Sprouts",        color: "#1d9e75", short: "Sprouts",
             note: "South trip only — Kait runs it for mold-free coffee + select organic. Very expensive; batch with other south errands." },
  costco:  { name: "Costco / bulk",  color: "#d85a30", short: "Costco",
             note: "Bulk week only (Week 3 of cycle). Membership TBD; bulk envelope is separate from weekly $215." },
  tj:      { name: "Trader Joe's",   color: "#ba7517", short: "Trader Joe's",
             note: "Flowers + event needs. A little further away, nice when it lines up with a south trip." },
  coastal: { name: "Coastal",        color: "#888780", short: "Coastal",
             note: "Organic chicken feed (~monthly, Week 2 of cycle)." },
  rawmilk: { name: "Raw milk pickup",color: "#d4537e", short: "Raw milk",
             note: "Kait's pickup spot — 2 gallons @ $10 each. Stock-up, not weekly." },
  online:  { name: "Online",         color: "#534ab7", short: "Online",
             note: "Mold-free coffee backup, glass/pantry restocks. Use when in-store options run out." },
};

export const STORE_ORDER = ["grocout", "fred", "target", "coop", "sprouts", "costco", "coastal", "tj", "rawmilk", "online"];

// ---- Route plan with spend targets + fallbacks ----
// `tip` is the agent-readable summary of how to use this stop. Tips combine
// with STORE.note in agent prompts. Targets are still estimates pending real
// receipts (HANDOFF.md known gap).
export const ROUTE_PLAN: { key: string; target: number; fallback: string | null; tip: string }[] = [
  { key: "grocout", target: 60,  fallback: "fred",    tip: "Start here for cheapest finds; anything missing rolls forward." },
  { key: "fred",    target: 110, fallback: null,      tip: "Catch-all + pickup. Reliable but higher per-item; use after Grocery Outlet." },
  { key: "target",  target: 60,  fallback: "fred",    tip: "Pickup alternative to Fred Meyer when it's closer or has a specific thing." },
  { key: "coop",    target: 25,  fallback: "grocout", tip: "Raw milk run. Quick stop." },
  { key: "sprouts", target: 40,  fallback: "online",  tip: "South trip only — mold-free coffee + organic. Batch it." },
  { key: "costco",  target: 200, fallback: null,      tip: "Bulk week only (Week 3). Separate envelope." },
  { key: "coastal", target: 35,  fallback: null,      tip: "Chicken feed, ~monthly (Week 2)." },
  { key: "tj",      target: 25,  fallback: null,      tip: "Flowers + event needs." },
  { key: "rawmilk", target: 20,  fallback: "coop",    tip: "2 gallons @ $10. Stock-up, not weekly." },
  { key: "online",  target: 30,  fallback: null,      tip: "Coffee backup, glass + pantry restock." },
];

// ---- Auto-routing keywords -> store ----
const ROUTE: [RegExp, string][] = [
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

export function routeStore(name: string): string {
  for (const [re, s] of ROUTE) if (re.test(name)) return s;
  return "fred";
}

// ---- Tap-to-add staples ----
export const STAPLES = [
  "Coconut milk", "Raw milk", "Chuck roast", "Organic chicken (pasture eggs)", "Bananas (lots)",
  "Watermelon", "Cara cara oranges", "Organic honeycrisp apples", "Seasonal fruit",
  "Oranges", "Paper towels", "Goodles mac & cheese", "Tuna / mackerel tins", "Potatoes",
  "GF wraps / bread", "Yogurt", "Protein powder", "Mold-free coffee", "Decaf coffee (study)",
  "Ground beef (organic)", "Shredded cheese", "Refried beans (good quality)", "Tortilla chips",
  "Olipop / Zevia", "Cheese (grilled cheese)", "Turkey (deli)", "Coastal chicken feed", "Onions / garlic",
];

// ---- Idea banks ----
export const LAZY_IDEAS = [
  "Loaded nachos (ground beef, cheese, refried beans)",
  "Burgers / burger bowls + fries",
  "Tacos / quesadilla / burrito bowls",
  "Chicken Caesar salad (bagged + rotisserie)",
  "Chicken & kale salad (bagged + rotisserie)",
  "Beans & bacon (one pot)",
  "Hot dogs + chips + fruit",
  "Eggs & toast for dinner",
  "Deli wraps + fruit",
  "Frozen GF pizza + salad",
];

export const MEDIUM_IDEAS = [
  "Salmon + roasted potatoes",
  "Tater tot casserole (green beans, tater tots, cream of mushroom, ground beef)",
  "Spaghetti (GF pasta)",
  "Chicken alfredo (GF pasta)",
  "Chili with cornbread",
  "Egg casserole",
  "German potatoes (vinegar, onion, beans, hot dogs)",
  "Baked potato bar",
  "Chuck roast tacos",
];

export const CROCK_IDEAS = [
  "Chuck roast + potatoes & carrots",
  "Crock pot pulled chicken bowls",
  "Chili (crock pot)",
  "Crock pot pulled pork",
  "Crock pot chicken & potatoes",
];

export const BAKING_IDEAS = [
  "Dutch apple pie", "Cookies (batch)", "Banana bread", "Apple crisp", "Muffins", "Brownies", "Coffee cake",
];

// ---- Default dinner rotation (seed) ----
export const DEFAULT_DINNERS = [
  { day: "Sunday",    tag: "crock", label: "Crock pot",   meal: "Chuck roast + potatoes & carrots (crock pot)", note: "Makes leftovers for Mon lunch + Tue dinner", sortOrder: 0 },
  { day: "Monday",    tag: "left",  label: "Leftovers",   meal: "Roast leftovers, fresh side salad", note: "", sortOrder: 1 },
  { day: "Tuesday",   tag: "lazy",  label: "Lazy",        meal: "Tacos / quesadilla / burrito bowls", note: "", sortOrder: 2 },
  { day: "Wednesday", tag: "lazy",  label: "Lazy",        meal: "Burger bowls + fries", note: "", sortOrder: 3 },
  { day: "Thursday",  tag: "cook",  label: "Bible study", meal: "Chili with cornbread", note: "Bible study tonight — keep decaf coffee + snacks stocked; treat optional", sortOrder: 4 },
  { day: "Friday",    tag: "cook",  label: "Real cook",   meal: "Salmon + roasted potatoes", note: "Grilled cheese backup for girls", sortOrder: 5 },
  { day: "Saturday",  tag: "flex",  label: "Flex / out",  meal: "Loaded nachos or leftovers", note: "Covers potluck weeks", sortOrder: 6 },
];

export const WEEKS = [
  { n: 1, budget: "$215",            tags: [["normal", "Normal week"], ["event", "Bible study"]], desc: "Lean weekly run. Fred Meyer pickup." },
  { n: 2, budget: "$215 + feed",     tags: [["feed", "Coastal feed run"], ["normal", "Normal week"], ["event", "Bible study"]], desc: "Add ~monthly chicken feed." },
  { n: 3, budget: "$215 + ~$200 bulk", tags: [["big", "Costco / bulk trip"], ["event", "Bible study"]], desc: "Stock paper towels, drinks, freezer protein, pantry." },
];

export const WEEKLY_TARGET = 215;
