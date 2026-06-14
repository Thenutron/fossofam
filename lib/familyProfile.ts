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

export type Person = {
  key: string;
  name: string;
  role: "adult" | "child";
  dietary: string[];
  patterns: {
    breakfast?: string;
    lunch?: string;
    dinner?: string;
    notes?: string;
  };
};

export const PEOPLE: Person[] = [
  {
    key: "knute",
    name: "Knute",
    role: "adult",
    dietary: ["gluten-free", "sometimes dairy-free"],
    patterns: {
      breakfast: "high-protein only — protein powder + yogurt, mackerel/tuna tin, or dinner leftovers",
      lunch: "same as breakfast — high protein only",
      notes: "prefers high-protein everything",
    },
  },
  {
    key: "kait",
    name: "Kait",
    role: "adult",
    dietary: ["gluten-free", "sometimes dairy-free"],
    patterns: {
      lunch: "fresh or leftovers — GF/DF tuna plate or turkey roll-ups (no bread, no GF wrap)",
      notes: "runs the south-trip store route (Sprouts for mold-free coffee)",
    },
  },
  {
    key: "girl1",
    name: "Girl 1",
    role: "child",
    dietary: ["healthy but not GF/DF restricted"],
    patterns: {
      breakfast: "Dutch baby ~1×/week; otherwise boiled eggs, oatmeal, yogurt",
      lunch: "half a sandwich, half a Goodles mac box (shared with sister)",
      notes: "small eater; loves grilled cheese; banana + book ritual at night",
    },
  },
  {
    key: "girl2",
    name: "Girl 2",
    role: "child",
    dietary: ["healthy but not GF/DF restricted"],
    patterns: {
      breakfast: "Dutch baby ~1×/week; otherwise boiled eggs, oatmeal, yogurt",
      lunch: "half a sandwich, half a Goodles mac box (shared with sister)",
      notes: "small eater; loves grilled cheese; banana + book ritual at night",
    },
  },
];

export const VALUES = [
  "organic where it matters (protein especially)",
  "clean eating, low-waste",
  "no plastic where possible — prefer glass packaging",
  "kill many birds with one stone (efficiency mindset)",
  "encouraging tone, never guilt",
];

export const DIETARY = {
  household: "gluten-free",
  optional: "sometimes dairy-free (adults only, per meal)",
  girls: "not GF/DF restricted, but want healthy",
  loves: ["potatoes (all forms)", "bananas (nightly)", "coconut milk", "mold-free coffee"],
};

export const RHYTHM = {
  weeklyTarget: WEEKLY_TARGET,
  cycle: {
    week1: "normal lean week",
    week2: "normal + Coastal chicken feed (~$35, monthly)",
    week3: "normal + Costco bulk (~$200, separate envelope)",
  },
  recurring: [
    "Bible study Thursdays (host extras; bake a treat to share)",
    "Coastal organic chicken feed monthly",
    "Raw milk pickup stock-up (2 gallons @ $10)",
    "Costco/bulk run every 3 weeks",
  ],
  futureChange: "Hens start laying August 2026 → pricey pasture-egg line drops, roughly offsets the chicken feed cost",
};

// Prose narrative an LLM can read as background context for any agent call.
// Keep this dense and accurate; it gets cached in prompt prefixes.
export const FAMILY_NARRATIVE = `# Who they are
The Fosso family: Knute and Kait (adults) plus two young girls.

# Dietary
- ${DIETARY.household.charAt(0).toUpperCase() + DIETARY.household.slice(1)} household
- ${DIETARY.optional}
- The girls: ${DIETARY.girls}
- Loves: ${DIETARY.loves.join(", ")}

# Values
${VALUES.map((v) => `- ${v}`).join("\n")}

# Per-person patterns
${PEOPLE.map((p) => `- ${p.name} (${p.role}, ${p.dietary.join(" + ")}): ${[
  p.patterns.breakfast && `breakfast — ${p.patterns.breakfast}`,
  p.patterns.lunch && `lunch — ${p.patterns.lunch}`,
  p.patterns.dinner && `dinner — ${p.patterns.dinner}`,
  p.patterns.notes,
].filter(Boolean).join("; ")}`).join("\n")}

# Budget rhythm
- Weekly grocery target: $${RHYTHM.weeklyTarget}/week (lean)
- 3-week cycle:
  - Week 1: ${RHYTHM.cycle.week1}
  - Week 2: ${RHYTHM.cycle.week2}
  - Week 3: ${RHYTHM.cycle.week3}
- Bulk envelope is SEPARATE — never folded into the weekly $${RHYTHM.weeklyTarget}

# Recurring obligations
${RHYTHM.recurring.map((r) => `- ${r}`).join("\n")}

# Forward-looking change
- ${RHYTHM.futureChange}`;
