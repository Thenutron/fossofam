import { db } from "./index";
import { dinners, household } from "./schema";
import { DEFAULT_DINNERS } from "../lib/data";

async function seed() {
  console.log("Seeding…");
  const existing = await db.select().from(dinners);
  if (existing.length === 0) {
    await db.insert(dinners).values(DEFAULT_DINNERS);
    console.log("✓ Dinners seeded");
  } else {
    console.log("• Dinners already present, skipping");
  }
  const hh = await db.select().from(household);
  if (hh.length === 0) {
    await db.insert(household).values({ id: 1, currentWeek: 1, lastWeekTotal: null });
    console.log("✓ Household row created");
  } else {
    console.log("• Household row already present, skipping");
  }
  console.log("Done.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
