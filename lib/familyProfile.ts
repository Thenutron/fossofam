// The Fosso family profile — the SINGLE SOURCE OF TRUTH for who they are.
//
// Every module + every agent route imports from here. If you're hardcoding
// a fact about the family anywhere else (dietary needs, store preferences,
// per-person patterns, the chickens-laying timeline), you're doing it
// wrong — add it here and import it.
//
// The shape is intentionally simple: structured data for things the code
// uses programmatically (people, dietary flags, values list), and a
// `narrative` string for things the LLM needs to read as prose. Adding a
// new field is cheap; renaming or removing one needs a grep first.

import { WEEKLY_TARGET } from "./data";

export type PersonPreferences = {
  likes: string[];
  dislikes: string[];
  allergies: string[];
  notes: string;
};

export type Person = {
  key: string;
  name: string;
  role: "adult" | "child";
  birthYear: number | null;
  dietary: string[];
  preferences: PersonPreferences;
  patterns: {
    breakfast?: string;
    lunch?: string;
    dinner?: string;
    notes?: string;
  };
};

// Compute age from birth year against the current real-world year. Drift is
// fine for our use — the agent uses ages as soft context, not for billing.
export function personAge(p: Person, now: Date = new Date()): number | null {
  if (p.birthYear == null) return null;
  return now.getFullYear() - p.birthYear;
}

export const PEOPLE: Person[] = [
  {
    key: "knute",
    name: "Knute",
    role: "adult",
    birthYear: 1998, // 27 as of 2026
    dietary: ["gluten-free", "sometimes dairy-free"],
    preferences: {
      likes: [
        "high protein (always)",
        "potatoes",
        "fresh greens",
        "all seafood including shellfish",
        "chuck roast",
        "canned mackerel (go-to lunch)",
        "protein powder shakes (morning go-to)",
      ],
      dislikes: [],
      allergies: [],
      notes: "Aiming for ~2000 cal/day or less. Breakfast/lunch is high-protein only. Eats dinner leftovers for next-day lunches. Nightly banana + book with the girls.",
    },
    patterns: {
      breakfast: "protein powder shake (most days); occasional yogurt or eggs",
      lunch: "canned mackerel go-to; otherwise dinner leftovers or a tuna tin",
      notes: "calorie-aware (~2k/day); prefers high-protein everything",
    },
  },
  {
    key: "kait",
    name: "Kait",
    role: "adult",
    birthYear: 1998, // 27 as of 2026
    dietary: ["gluten-free", "sometimes dairy-free"],
    preferences: {
      likes: [
        "high protein",
        "potatoes",
        "lots of fresh greens",
        "normal fish (salmon, tuna, etc.)",
      ],
      dislikes: [
        "shellfish",
        "anything beyond normal fish (no calamari, no octopus, no oysters)",
      ],
      allergies: [],
      notes: "Primary cook + shopper for the family. Runs south trips for Sprouts mold-free coffee.",
    },
    patterns: {
      lunch: "fresh or leftovers — GF/DF tuna plate or turkey roll-ups (no bread, no GF wrap)",
      notes: "primary cook + shopper",
    },
  },
  {
    key: "havyn",
    name: "Havyn",
    role: "child",
    birthYear: 2020, // 5.5 as of mid-2026
    dietary: ["healthy but not GF/DF restricted"],
    preferences: {
      likes: ["grilled cheese", "all seafood including shellfish", "bananas (nightly)"],
      dislikes: [],
      allergies: [],
      notes: "Small eater — can split one Goodles mac box with Revs. Banana + book ritual at night.",
    },
    patterns: {
      breakfast: "Dutch baby ~1×/week; otherwise boiled eggs, oatmeal, yogurt",
      lunch: "half a sandwich, half a Goodles mac box (shared with sister)",
      notes: "loves grilled cheese; small portions",
    },
  },
  {
    key: "revs",
    name: "Reverie",
    role: "child",
    birthYear: 2023, // 3 as of 2026
    dietary: ["healthy but not GF/DF restricted"],
    preferences: {
      likes: ["grilled cheese", "normal fish (salmon, tuna)", "bananas (nightly)"],
      dislikes: ["shellfish", "anything beyond normal fish"],
      allergies: [],
      notes: "Goes by 'Revs'. 3 years old. Small eater — splits one Goodles mac box with Havyn.",
    },
    patterns: {
      breakfast: "Dutch baby ~1×/week; otherwise boiled eggs, oatmeal, yogurt",
      lunch: "half a sandwich, half a Goodles mac box (shared with sister)",
      notes: "loves grilled cheese; small portions",
    },
  },
];

export const VALUES = [
  "ORGANIC BY DEFAULT — produce, meat, dairy, eggs, pantry staples. Specifically prefix shopping items with 'Organic' (e.g. 'Organic ground beef', 'Organic apples'). Non-organic only when (a) it's a specific brand the family already buys (like Goodles mac & cheese) or (b) organic isn't sold at the routed store and the item is something the family will accept conventional for (rare).",
  "clean eating, low-waste",
  "no plastic where possible — prefer glass packaging",
  "kill many birds with one stone (efficiency mindset)",
  "encouraging tone, never guilt",
];

// Voice / tonality the agent uses when writing summaries, recipe tips,
// and any user-facing text. Zillennial = late-90s adults, so the lingo
// is lived-in, not chronically-online. Calibrated to feel like a smart
// friend, not a brand trying too hard.
export const TONE = `# Voice

Write like a Zillennial friend with the family group chat:
- Dry, lightly self-aware humor — not LinkedIn-cringe, not TikTok-cringe
- Lowkey/highkey, "the vibes", "it's giving", "fr", "say less", "scrounge night", "we love that for us", "no thoughts head empty" — used sparingly and only when they land
- Casual contractions, sentence fragments, dashes for asides
- Acknowledge real-life stuff (girls splitting a Goodles box, banana ritual, host nights, ate-out detours) like you remember them
- Encouraging on budget — never preachy or guilt-trippy. Even when over budget, framing is "okay scrounge night era" not "you've failed"

What to avoid:
- Emoji walls. One or two emojis, max, when they actually fit
- Marketing speak ("elevate", "delicious", "indulgent", "treat yourself")
- Boomer-coded phrasing ("rest assured", "fear not", "without further ado")
- Trying to be funny when the user is clearly stressed (cleanse week, hard budget week, sick family)
- Calling them "babe" or "bestie" — that's parasocial, not friendly

Example summaries to calibrate against:
- "Cleanse era Mon–Wed for the adults, kids on regular food. Thu Bible study stays put. Weekend snaps back to chuck roast vibes."
- "Friday salmon → scrounge night (pantry raid). Saves ~$22 — back in budget."
- "Tater tot casserole Tues makes a giant pan; Wed lunches are free."`;

export const DIETARY = {
  household: "gluten-free",
  optional: "sometimes dairy-free (adults only, per meal)",
  girls: "not GF/DF restricted, but want healthy",
  loves: ["potatoes (all forms)", "bananas (nightly)", "coconut milk", "mold-free coffee", "fresh greens", "high-protein meals"],
};

// Steady-state weekly consumption. The agent should assume these are already
// part of the household's baseline grocery flow — don't propose them as
// "additions" unless quantities change. Useful for budget reasoning and for
// recognizing when something's unusual.
export const CONSUMPTION_BASELINES = [
  "2 gallons of milk per week",
  "1 loaf of bread per week",
  "2 dozen eggs per week (until hens start laying ~August 2026, then drops to maybe 1 dozen)",
  "1 bag of apples per week",
  "1 big Tillamook block of cheese lasts 1.5–2 weeks",
  "Bananas — many per week (nightly girl ritual)",
  "Protein powder — a couple bags every 3–4 weeks (HSA-paid, NOT counted against the weekly $215)",
];

// Things the family carves OUT of the weekly grocery budget. The agent should
// not count these against $215 when estimating weekly cost.
export const BUDGET_EXCLUSIONS = [
  "Protein powder (paid via HSA card, every 3–4 weeks)",
  "Costco bulk run (separate $200 envelope every 3 weeks)",
  "Coastal chicken feed (~$35 monthly, Week 2)",
];

// Treats the family genuinely enjoys (not the generic "dessert" set). Used
// when proposing baking-night ideas or "feel-good" tweaks to a plan.
export const TREATS = [
  "Bone broth hot chocolate (a household favorite)",
  "Dutch apple pie",
  "Cookies (batch)",
  "Banana bread",
  "Apple crisp",
];

export const RHYTHM = {
  weeklyTarget: WEEKLY_TARGET,
  cycle: {
    week1: "normal lean week",
    week2: "normal + Coastal chicken feed (~$35, monthly)",
    week3: "normal + Costco bulk (~$200, separate envelope)",
  },
  recurring: [
    "Bible study Thursdays — they HOST but DON'T cook for guests. Just snacks sometimes + decaf coffee (always have it on hand). A baked treat is occasional/optional, not expected.",
    "Coastal organic chicken feed monthly",
    "Raw milk pickup stock-up (2 gallons @ $10)",
    "Costco/bulk run every 3 weeks",
  ],
  futureChange: "Hens start laying August 2026 → pricey pasture-egg line drops, roughly offsets the chicken feed cost",
};

function formatPerson(p: Person): string {
  const age = personAge(p);
  const ageStr = age !== null ? `${age}` : "unknown age";
  const lines = [
    `### ${p.name} (${ageStr}, ${p.role}, ${p.dietary.join(" + ")})`,
  ];
  if (p.preferences.likes.length) lines.push(`- Likes: ${p.preferences.likes.join(", ")}`);
  if (p.preferences.dislikes.length) lines.push(`- Dislikes: ${p.preferences.dislikes.join(", ")}`);
  if (p.preferences.allergies.length) lines.push(`- Allergies: ${p.preferences.allergies.join(", ")}`);
  if (p.preferences.notes) lines.push(`- Notes: ${p.preferences.notes}`);
  const patternBits = [
    p.patterns.breakfast && `breakfast — ${p.patterns.breakfast}`,
    p.patterns.lunch && `lunch — ${p.patterns.lunch}`,
    p.patterns.dinner && `dinner — ${p.patterns.dinner}`,
  ].filter(Boolean);
  if (patternBits.length) lines.push(`- Pattern: ${patternBits.join("; ")}`);
  return lines.join("\n");
}

// Prose narrative an LLM can read as background context for any agent call.
// Keep this dense and accurate; it gets cached in prompt prefixes.
export const FAMILY_NARRATIVE = `# Who they are
The Fosso family: Knute and Kait (both 27) plus two daughters — Havyn (5.5) and Reverie / "Revs" (3).

# Dietary (household-wide)
- ${DIETARY.household.charAt(0).toUpperCase() + DIETARY.household.slice(1)} household
- ${DIETARY.optional}
- The girls: ${DIETARY.girls}
- Loves: ${DIETARY.loves.join(", ")}

# Values
${VALUES.map((v) => `- ${v}`).join("\n")}

# Per-person profiles
${PEOPLE.map(formatPerson).join("\n\n")}

# Budget rhythm
- Weekly grocery target: $${RHYTHM.weeklyTarget}/week (lean)
- 3-week cycle:
  - Week 1: ${RHYTHM.cycle.week1}
  - Week 2: ${RHYTHM.cycle.week2}
  - Week 3: ${RHYTHM.cycle.week3}
- Bulk envelope is SEPARATE — never folded into the weekly $${RHYTHM.weeklyTarget}

# Weekly consumption baselines (assume these are already in the flow)
${CONSUMPTION_BASELINES.map((c) => `- ${c}`).join("\n")}

# Budget exclusions (DO NOT count these against the weekly $${RHYTHM.weeklyTarget})
${BUDGET_EXCLUSIONS.map((b) => `- ${b}`).join("\n")}

# Treats they actually like
${TREATS.map((t) => `- ${t}`).join("\n")}

# Recurring obligations
${RHYTHM.recurring.map((r) => `- ${r}`).join("\n")}

# Forward-looking change
- ${RHYTHM.futureChange}`;
