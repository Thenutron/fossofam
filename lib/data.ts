// ---- Stores ----
export const STORE: Record<string, { name: string; color: string; short: string }> = {
  fred:    { name: "Fred Meyer",     color: "#378add", short: "Fred Meyer" },
  coop:    { name: "Co-op",          color: "#1d9e75", short: "Co-op" },
  sprouts: { name: "Sprouts",        color: "#1d9e75", short: "Sprouts" },
  grocout: { name: "Grocery Outlet", color: "#639922", short: "Groc. Outlet" },
  costco:  { name: "Costco / bulk",  color: "#d85a30", short: "Costco" },
  tj:      { name: "Trader Joe's",   color: "#ba7517", short: "Trader Joe's" },
  coastal: { name: "Coastal",        color: "#888780", short: "Coastal" },
  rawmilk: { name: "Raw milk pickup",color: "#d4537e", short: "Raw milk" },
  online:  { name: "Online",         color: "#534ab7", short: "Online" },
};

export const STORE_ORDER = ["grocout", "fred", "coop", "sprouts", "costco", "coastal", "tj", "rawmilk", "online"];

// ---- Route plan with spend targets + fallbacks ----
export const ROUTE_PLAN: { key: string; target: number; fallback: string | null; tip: string }[] = [
  { key: "grocout", target: 60,  fallback: "fred",   tip: "Cheapest — start here. Stock varies, grab what's available." },
  { key: "fred",    target: 110, fallback: null,     tip: "Reliable catch-all. Order pickup for known staples." },
  { key: "coop",    target: 25,  fallback: "grocout",tip: "Raw milk run. Quick stop." },
  { key: "sprouts", target: 40,  fallback: "online", tip: "South trip only — coffee + organic. Batch it." },
  { key: "costco",  target: 200, fallback: null,     tip: "Bulk week only (Week 3)." },
  { key: "coastal", target: 35,  fallback: null,     tip: "Chicken feed, ~monthly (Week 2)." },
  { key: "tj",      target: 25,  fallback: null,     tip: "Flowers + event needs." },
  { key: "rawmilk", target: 20,  fallback: "coop",   tip: "2 gallons @ $10. Stock-up, not weekly." },
  { key: "online",  target: 30,  fallback: null,     tip: "Coffee backup, glass + pantry restock." },
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
  { day: "Thursday",  tag: "flex",  label: "Bible study", meal: "Chili with cornbread — feeds extras", note: "Decaf ready · bake a treat to share?", sortOrder: 4 },
  { day: "Friday",    tag: "cook",  label: "Real cook",   meal: "Salmon + roasted potatoes", note: "Grilled cheese backup for girls", sortOrder: 5 },
  { day: "Saturday",  tag: "flex",  label: "Flex / out",  meal: "Loaded nachos or leftovers", note: "Covers potluck weeks", sortOrder: 6 },
];

export const WEEKS = [
  { n: 1, budget: "$215",            tags: [["normal", "Normal week"], ["event", "Bible study"]], desc: "Lean weekly run. Fred Meyer pickup." },
  { n: 2, budget: "$215 + feed",     tags: [["feed", "Coastal feed run"], ["normal", "Normal week"], ["event", "Bible study"]], desc: "Add ~monthly chicken feed." },
  { n: 3, budget: "$215 + ~$200 bulk", tags: [["big", "Costco / bulk trip"], ["event", "Bible study"]], desc: "Stock paper towels, drinks, freezer protein, pantry." },
];

export const WEEKLY_TARGET = 215;
