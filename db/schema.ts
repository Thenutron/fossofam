import { pgTable, serial, text, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";

// Single shared household row keeps the "which week" + last-week total state.
export const household = pgTable("household", {
  id: integer("id").primaryKey().default(1),
  currentWeek: integer("current_week").notNull().default(1),
  lastWeekTotal: real("last_week_total"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Out-of / shopping items. store is the routed store key.
export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  store: text("store").notNull().default("fred"),
  done: boolean("done").notNull().default(false),
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

// Logged grocery expenses for the current week.
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  kind: text("kind").notNull().default("weekly"), // weekly | bulk
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Item = typeof items.$inferSelect;
export type Dinner = typeof dinners.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Household = typeof household.$inferSelect;
