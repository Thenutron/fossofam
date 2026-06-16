// Agent tool registry — the catalog of structured actions the agent can take.
//
// Each tool has:
//   - name (stable, snake_case)
//   - description (what the agent reads to decide whether to call it)
//   - input_schema (JSON Schema constraining the agent's output)
//   - intent (free-text describing when the user's note matches this tool)
//
// New modules add new tools here. The /api/agent dispatcher loads all of them
// and lets the model pick. For now the dispatcher picks the tool client-side
// (via an explicit `tool` field on the request) — when we have 5+ tools we'll
// let the model route, but explicit is fine while there are only a couple.

import { STORE_ORDER } from "./data";

export type AgentToolName = "modify_week" | "get_recipe" | "import_recipe" | "parse_receipt" | "plan_shopping" | "modify_recipe" | "suggest_meal";

export type AgentTool = {
  name: AgentToolName;
  description: string;
  input_schema: Record<string, unknown>;
};

const VALID_TAGS = ["crock", "lazy", "cook", "left", "flex"];
const VALID_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// --- modify_week ---
// Take a freeform note about the week and propose dinner-rotation changes
// plus shopping-list additions. The user previews and accepts/rejects.
const modifyWeekTool: AgentTool = {
  name: "modify_week",
  description:
    "Propose changes to the family's weekly meal plan and shopping list based on the user's note. The family will preview and accept or reject the proposal — do not apply directly.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Short, friendly explanation (1-3 sentences) of what you're proposing and why. Use the family's tone — see TONE in the system prompt.",
      },
      estimated_weekly_cost: {
        type: "number",
        description: "Your best estimate of the total weekly grocery cost (in dollars, integer-ish) after this proposal is applied. Excludes bulk envelope. Be realistic — over-promise nothing.",
      },
      budget_status: {
        type: "string",
        enum: ["under", "at", "over"],
        description: "Compared to the $215/week target: 'under' (≤$200), 'at' (within $15 either way), 'over' (>$230).",
      },
      scrounge_suggestion: {
        type: "string",
        description: "If budget_status is 'over' OR if the family's note suggests a tight week, propose a 'scrounge night' day name + brief idea (e.g. 'Friday — pantry raid, eggs + leftovers, no shopping'). Leave empty string otherwise.",
      },
      dinner_changes: {
        type: "array",
        description: "List of dinner-slot changes. Include ONLY the days you are changing — leave untouched days out of this array.",
        items: {
          type: "object",
          properties: {
            day: { type: "string", enum: VALID_DAYS },
            meal: { type: "string", description: "New meal text. Concise, phone-glanceable. Empty if skipping." },
            tag: { type: "string", enum: VALID_TAGS },
            label: { type: "string", description: "Short label shown next to the day (e.g. 'Crock pot', 'Bible study', 'Real cook', 'Leftovers')." },
            note: { type: "string", description: "Optional short note. Empty if none." },
            skip: { type: "boolean" },
            skipReason: { type: "string", description: "Only meaningful if skip is true." },
          },
          required: ["day", "meal", "tag", "label", "note", "skip", "skipReason"],
          additionalProperties: false,
        },
      },
      shopping_additions: {
        type: "array",
        description: "Items the proposed plan requires that aren't already on the list. Leave empty if none.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            store: { type: "string", enum: STORE_ORDER },
          },
          required: ["name", "store"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "dinner_changes", "shopping_additions"],
    additionalProperties: false,
  },
};

// --- get_recipe ---
// Generate a structured recipe for a specific meal. Returns ingredients +
// steps + tips so the UI can render properly instead of dumping prose.
const getRecipeTool: AgentTool = {
  name: "get_recipe",
  description:
    "Generate a structured recipe for the family. Respect their dietary constraints (GF household, sometimes DF for adults, girls are flexible), their love of potatoes, and the effort tier (lazy=under 5min prep, medium=some cook, crock=set-and-forget, bake=double-duty for Bible study).",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short recipe title." },
      servings: { type: "string", description: "Sized for the Fosso family — typically 2 adults + 2 small-portion girls + a little extra for Knute's high-protein leftovers." },
      prep_time: { type: "string", description: "e.g. '5 min', '20 min'" },
      cook_time: { type: "string", description: "e.g. '15 min', '8 hours (crock)'" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            amount: { type: "string", description: "e.g. '2 lbs', '1 cup', 'a pinch'" },
            note: { type: "string", description: "Optional note (e.g. 'organic preferred', 'GF brand: Schar')." },
          },
          required: ["item", "amount", "note"],
          additionalProperties: false,
        },
      },
      steps: {
        type: "array",
        description: "Numbered steps as concise sentences.",
        items: { type: "string" },
      },
      tips: {
        type: "array",
        description: "Family-relevant tips (DF swap, where to buy, leftover ideas, kid-friendly tweaks). 1-3 items, can be empty.",
        items: { type: "string" },
      },
      when_to_start: {
        type: "string",
        description: "For crock pot recipes only — when to start it so dinner is ready on time. Empty string otherwise.",
      },
    },
    required: ["title", "servings", "prep_time", "cook_time", "ingredients", "steps", "tips", "when_to_start"],
    additionalProperties: false,
  },
};

// --- import_recipe ---
// Parse a recipe page that the family pasted in. Returns the structured
// recipe + a suggested day + tag + label + shopping additions for any
// ingredients that look like new buys + a fit-warning if the recipe collides
// with per-person preferences (e.g. shellfish for Kait/Revs).
const importRecipeTool: AgentTool = {
  name: "import_recipe",
  description:
    "Extract a structured recipe from web page text. Identify the actual recipe (ingredients, steps, times) and ignore the surrounding blog narrative. Also suggest which day of the week to slot it into and flag any conflicts with the family's dietary needs or per-person preferences.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      source_summary: {
        type: "string",
        description: "1-2 sentences in the family's tone — what this recipe is, why it might fit them. Be honest if it's a stretch (high-effort, expensive ingredients, kid-unfriendly).",
      },
      servings: { type: "string" },
      prep_time: { type: "string" },
      cook_time: { type: "string" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            amount: { type: "string" },
            note: { type: "string" },
          },
          required: ["item", "amount", "note"],
          additionalProperties: false,
        },
      },
      steps: {
        type: "array",
        description: "Concise step sentences. DO NOT prefix with numbers — the UI renders them as an ordered list.",
        items: { type: "string" },
      },
      suggested_day: {
        type: "string",
        enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", ""],
        description: "Best-fit day given the prep effort. Empty string if you can't decide.",
      },
      suggested_tag: { type: "string", enum: VALID_TAGS },
      suggested_label: { type: "string", description: "Short label that fits the tag (e.g. 'Crock pot', 'Real cook', 'Lazy')." },
      shopping_additions: {
        type: "array",
        description: "Ingredients the family likely needs to buy. Skip items they almost certainly have on hand (salt, pepper, oil, basic spices, eggs, milk, bread).",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            store: { type: "string", enum: STORE_ORDER },
          },
          required: ["name", "store"],
          additionalProperties: false,
        },
      },
      family_fit_warnings: {
        type: "string",
        description: "Flag any clash with per-person preferences (e.g. shellfish — Kait/Revs don't eat) or household dietary rules (gluten). Empty string if clean.",
      },
    },
    required: [
      "title", "source_summary", "servings", "prep_time", "cook_time",
      "ingredients", "steps", "suggested_day", "suggested_tag",
      "suggested_label", "shopping_additions", "family_fit_warnings",
    ],
    additionalProperties: false,
  },
};

// --- parse_receipt ---
// OCR + diff the family's receipt photo against what's currently in their
// shopping cart. Returns a structured diff so the client can update item
// costs, surface duplicates, and log the trip at the receipt total.
const parseReceiptTool: AgentTool = {
  name: "parse_receipt",
  description:
    "Read a photo of a grocery receipt and reconcile it against the cart. Identify the store + grand total, match each receipt line to a cart item id (fuzzy — receipts use abbreviations like ORG, GRD BF), and split the rest into receipt_only (on receipt, missing from cart) and cart_only (in cart, not on receipt). If the photo is unreadable, return store='unknown', total=0, empty arrays, and explain in notes.",
  input_schema: {
    type: "object",
    properties: {
      store: {
        type: "string",
        description: "Store name from the receipt header (e.g. 'Fred Meyer', 'Grocery Outlet'). Use 'unknown' if you can't read it.",
      },
      total: {
        type: "number",
        description: "Receipt grand total in dollars. 0 if unreadable.",
      },
      subtotal: {
        type: "number",
        description: "Subtotal before tax (if visible). 0 if not present.",
      },
      tax: {
        type: "number",
        description: "Tax amount (if visible). 0 if not present.",
      },
      matched: {
        type: "array",
        description: "Receipt lines you successfully matched to a cart item.",
        items: {
          type: "object",
          properties: {
            item_id: { type: "integer", description: "The cart item's id." },
            cart_name: { type: "string", description: "The cart item's name (echo back)." },
            receipt_name: { type: "string", description: "Raw text as it appeared on the receipt." },
            price_in_cart: {
              type: ["number", "null"],
              description: "The cart item's current cost. Null if not yet priced.",
            },
            price_on_receipt: { type: "number" },
          },
          required: ["item_id", "cart_name", "receipt_name", "price_on_receipt", "price_in_cart"],
          additionalProperties: false,
        },
      },
      receipt_only: {
        type: "array",
        description: "Receipt lines that don't match anything in the cart. The family probably bought these but forgot to put them on the list.",
        items: {
          type: "object",
          properties: {
            receipt_name: { type: "string", description: "Cleaned-up product name (expand abbreviations: 'GRD BF' → 'Ground beef'). Not the raw receipt text." },
            price: { type: "number" },
            suggested_store: { type: "string", enum: STORE_ORDER, description: "Best guess store key — usually matches the receipt's store." },
          },
          required: ["receipt_name", "price", "suggested_store"],
          additionalProperties: false,
        },
      },
      cart_only: {
        type: "array",
        description: "Cart items that aren't on this receipt. Could be a different store's items, or the family didn't actually buy them.",
        items: {
          type: "object",
          properties: {
            item_id: { type: "integer" },
            cart_name: { type: "string" },
            cart_price: { type: ["number", "null"] },
          },
          required: ["item_id", "cart_name", "cart_price"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "string",
        description: "Any caveats — blurry sections, items you couldn't decide on, store guesses. Keep it short. Empty string if nothing to flag.",
      },
    },
    required: ["store", "total", "subtotal", "tax", "matched", "receipt_only", "cart_only", "notes"],
    additionalProperties: false,
  },
};

// --- plan_shopping ---
// Read the family's current 7-day dinner plan and propose the items they
// need to BUY to actually make all those meals. Skips dupes and pantry
// staples. Doesn't touch the dinners themselves — read-only on the plan.
const planShoppingTool: AgentTool = {
  name: "plan_shopping",
  description:
    "Read the family's current 7-day dinner plan + the existing shopping list, and propose the items they need to BUY this week to make all the dinners happen. Don't change the dinners. Don't propose items already on the list. Skip pantry staples (salt/pepper/oil/flour/sugar/basic spices/butter/garlic powder/eggs/milk unless quantity is high). Focus on meat, produce, specialty items, and anything explicitly mentioned in a dinner's note. ALWAYS estimate the total cost vs the family's $215 weekly target — use any 'last paid' prices from the cart for grounding.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "1-2 sentences in the family's tone — what you found across the dinners.",
      },
      shopping_additions: {
        type: "array",
        description: "Specific items the family needs to buy. Quantity matters — '2 lbs ground beef' beats just 'ground beef'.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            store: { type: "string", enum: STORE_ORDER },
            for_meal: {
              type: "string",
              description: "Which day(s) this is for, terse — e.g. 'Sun crock' / 'Tue tacos + Wed burgers'. Helps the family understand why it's listed.",
            },
            est_cost: {
              type: "number",
              description: "Best-effort estimated cost in dollars. Use historical 'last paid' prices when an analogous item was bought before, otherwise estimate from your knowledge of typical PNW grocery prices.",
            },
          },
          required: ["name", "store", "for_meal", "est_cost"],
          additionalProperties: false,
        },
      },
      estimated_weekly_cost: {
        type: "number",
        description: "Total estimated cost of all shopping_additions in dollars. Round to whole dollars.",
      },
      budget_status: {
        type: "string",
        enum: ["under", "at", "over"],
        description: "vs $215 target: 'under' (≤$200), 'at' (within ±$15), 'over' (>$230).",
      },
      scrounge_suggestion: {
        type: "string",
        description: "If budget_status is 'over', propose a 'scrounge night' day swap (day name + brief idea, e.g. 'Friday — pantry raid, eggs + leftovers'). Empty string otherwise. Honor the tone.",
      },
      notes: {
        type: "string",
        description: "Caveats — meals you couldn't decode, items you deliberately skipped as 'probably already have', etc. Empty if clean.",
      },
    },
    required: ["summary", "shopping_additions", "estimated_weekly_cost", "budget_status", "scrounge_suggestion", "notes"],
    additionalProperties: false,
  },
};

// --- modify_recipe ---
// Mid-cook substitution / kid-friendly tweak / dietary swap. Takes the
// current recipe + a freeform modification note ("out of cream", "use
// chicken instead of beef") and returns the updated recipe + a short
// change summary in the family's tone.
const modifyRecipeTool: AgentTool = {
  name: "modify_recipe",
  description:
    "Modify an existing recipe based on the family's request. Common requests: 'out of X', 'use Y instead of Z', 'make it dairy-free', 'kid version'. Keep the recipe's structure intact. Respect dietary constraints (GF household). Adjust ingredients + steps as needed. Always include a short change_summary in the family's voice — they're probably mid-cook and need context fast.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Updated title — keep similar if changes are minor." },
      servings: { type: "string" },
      prep_time: { type: "string" },
      cook_time: { type: "string" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            amount: { type: "string" },
            note: { type: "string" },
          },
          required: ["item", "amount", "note"],
          additionalProperties: false,
        },
      },
      steps: { type: "array", items: { type: "string" } },
      tips: { type: "array", items: { type: "string" } },
      when_to_start: { type: "string" },
      change_summary: {
        type: "string",
        description: "1-2 sentences in family tone — what you changed and why. Be terse and useful.",
      },
    },
    required: ["title", "servings", "prep_time", "cook_time", "ingredients", "steps", "tips", "when_to_start", "change_summary"],
    additionalProperties: false,
  },
};

// --- suggest_meal ---
// One-shot fresh idea for a specific day + effort tier. Used by the
// per-day "🎲 AI idea" chip in the swap picker. Keeps the family from
// having to type into Modify Week every time they want one new meal.
const suggestMealTool: AgentTool = {
  name: "suggest_meal",
  description:
    "Generate exactly ONE fresh meal idea for a specific day + effort tier. Respect dietary constraints (GF household, sometimes DF). Honor per-person preferences (Kait + Revs no shellfish; Knute + Havyn all seafood; Knute high-protein; Kait lots of greens). Don't repeat anything already in the week's rotation. Be specific — 'salmon + roasted potatoes' beats 'fish'. Match the effort tier exactly: lazy = under 5min prep, cook = real cook night, crock = set-and-forget.",
  input_schema: {
    type: "object",
    properties: {
      meal: {
        type: "string",
        description: "Concise meal name, phone-glanceable.",
      },
      label: {
        type: "string",
        description: "Short tag label that fits the requested tier (e.g. 'Lazy', 'Real cook', 'Crock pot').",
      },
      note: {
        type: "string",
        description: "Optional 1-line context (cooking tip, leftover hint, GF brand). Empty string if none.",
      },
      reason: {
        type: "string",
        description: "1 sentence in family tone — why this idea fits this day. Terse.",
      },
    },
    required: ["meal", "label", "note", "reason"],
    additionalProperties: false,
  },
};

export const AGENT_TOOLS: AgentTool[] = [modifyWeekTool, getRecipeTool, importRecipeTool, parseReceiptTool, planShoppingTool, modifyRecipeTool, suggestMealTool];

export function getTool(name: AgentToolName): AgentTool {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown agent tool: ${name}`);
  return tool;
}

// Type contracts for tool outputs. The route handler asserts these after
// the LLM returns its tool_use block; the UI consumes these typed shapes.

export type ModifyWeekProposal = {
  summary: string;
  dinner_changes: {
    day: string;
    meal: string;
    tag: string;
    label: string;
    note: string;
    skip: boolean;
    skipReason: string;
  }[];
  shopping_additions: {
    name: string;
    store: string;
  }[];
};

export type RecipeProposal = {
  title: string;
  servings: string;
  prep_time: string;
  cook_time: string;
  ingredients: { item: string; amount: string; note: string }[];
  steps: string[];
  tips: string[];
  when_to_start: string;
};

export type ImportRecipeProposal = {
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

export type SuggestMealProposal = {
  meal: string;
  label: string;
  note: string;
  reason: string;
};

export type ModifyRecipeProposal = {
  title: string;
  servings: string;
  prep_time: string;
  cook_time: string;
  ingredients: { item: string; amount: string; note: string }[];
  steps: string[];
  tips: string[];
  when_to_start: string;
  change_summary: string;
};

export type PlanShoppingProposal = {
  summary: string;
  shopping_additions: { name: string; store: string; for_meal: string; est_cost: number }[];
  estimated_weekly_cost: number;
  budget_status: "under" | "at" | "over";
  scrounge_suggestion: string;
  notes: string;
};

export type ReceiptProposal = {
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

export type ToolOutput =
  | { tool: "modify_week"; data: ModifyWeekProposal }
  | { tool: "get_recipe"; data: RecipeProposal }
  | { tool: "import_recipe"; data: ImportRecipeProposal }
  | { tool: "parse_receipt"; data: ReceiptProposal }
  | { tool: "plan_shopping"; data: PlanShoppingProposal }
  | { tool: "modify_recipe"; data: ModifyRecipeProposal }
  | { tool: "suggest_meal"; data: SuggestMealProposal };
