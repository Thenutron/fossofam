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

export type AgentToolName = "modify_week" | "get_recipe";

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
        description: "A short, friendly explanation (1-3 sentences) of what you're proposing and why, written for the family to read in the preview.",
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

export const AGENT_TOOLS: AgentTool[] = [modifyWeekTool, getRecipeTool];

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

export type ToolOutput =
  | { tool: "modify_week"; data: ModifyWeekProposal }
  | { tool: "get_recipe"; data: RecipeProposal };
