import { pgTable, serial, text, integer, boolean, timestamp, real, jsonb } from "drizzle-orm/pg-core";

// Single shared household row keeps the "which week" + last-week total state.
export const household = pgTable("household", {
  id: integer("id").primaryKey().default(1),
  currentWeek: integer("current_week").notNull().default(1),
  lastWeekTotal: real("last_week_total"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Out-of / shopping items. `store` is the routed store key.
// `cost` is the last paid price (nullable). It's how shop-mode persists
// per-item prices — same item next week comes pre-filled, and the agent
// can ground budget estimates in real receipt numbers instead of guesses.
export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  store: text("store").notNull().default("fred"),
  done: boolean("done").notNull().default(false),
  cost: real("cost"),
  costAt: timestamp("cost_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// The 7 dinner slots. Editable meal text + skip state.
export const dinners = pgTable("dinners", {
  id: serial("id").primaryKey(),
  day: text("day").notNull(),
  tag: text("tag").notNull(),
  label: text("label").notNull(),
  meal: text("meal").notNull().default(""),
  note: text("note").default(""),
  skip: boolean("skip").notNull().default(false),
  skipReason: text("skip_reason").default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Logged expenses. `category` opens this beyond groceries (Phase 3 budget
// categories) without breaking existing rows. Default keeps current rows
// counted as groceries.
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  kind: text("kind").notNull().default("weekly"), // weekly | bulk
  category: text("category").notNull().default("groceries"), // groceries | bills | kids | eating-out | feed | gifts | other
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Household members. Lets future modules attribute per-person (e.g. "Knute's
// lunches", "girls' dentist appointment") without re-encoding the family in
// every prompt. Seeded by db/seed.ts. The preferences blob is a JSON object:
// { likes: string[]; dislikes: string[]; allergies: string[]; notes: string }.
// Kept loose-typed in JSON so it's cheap to extend without migrations.
export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // stable slug: knute | kait | girl1 | girl2
  name: text("name").notNull(),
  role: text("role").notNull(), // adult | child
  birthYear: integer("birth_year"), // nullable; agent computes age from it
  dietary: text("dietary").notNull().default(""), // comma-separated flags
  preferences: jsonb("preferences"), // { likes, dislikes, allergies, notes }
  notes: text("notes").default(""), // free-text behavioral notes
  sortOrder: integer("sort_order").notNull().default(0),
});

// Cached recipes keyed by canonical meal name. Hit on get_recipe before
// burning an LLM call. usedCount + lastUsedAt let us prioritize / prune
// later. Payload is the same RecipeProposal shape the client renders.
export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  mealCanonical: text("meal_canonical").notNull().unique(),
  mealName: text("meal_name").notNull(),
  kind: text("kind"),
  payload: jsonb("payload").notNull(),
  usedCount: integer("used_count").notNull().default(1),
  lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Every AI/agent call writes one row here: input note, output proposal,
// whether the user accepted it, which tool ran, which model was used.
// This is the substrate for memory ("what worked last cleanse?") and audit
// ("why did Tuesday become salmon?"). Trivial to add now, painful later.
export const agentProposals = pgTable("agent_proposals", {
  id: serial("id").primaryKey(),
  tool: text("tool").notNull(), // modify_week | get_recipe | etc.
  model: text("model").notNull(),
  inputNote: text("input_note").notNull(),
  inputContext: jsonb("input_context"), // snapshot of relevant state (dinners, items, etc.)
  output: jsonb("output").notNull(), // the tool call's input — the proposal itself
  status: text("status").notNull().default("proposed"), // proposed | applied | rejected
  appliedAt: timestamp("applied_at"),
  usageInputTokens: integer("usage_input_tokens"),
  usageOutputTokens: integer("usage_output_tokens"),
  usageCacheReadTokens: integer("usage_cache_read_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Item = typeof items.$inferSelect;
export type Dinner = typeof dinners.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Household = typeof household.$inferSelect;
export type Person = typeof people.$inferSelect;
export type AgentProposal = typeof agentProposals.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
