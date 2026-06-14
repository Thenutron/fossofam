import { db } from "./index";
import { dinners, household } from "./schema";
import { DEFAULT_DINNERS } from "../lib/data";

async function seed() {
  const force = process.argv.includes("--force");
  console.log(force ? "Seeding (force)…" : "Seeding…");
  const existing = await db.select().from(dinners);
  if (existing.length === 0 || force) {
    if (existing.length > 0) {
      await db.delete(dinners);
      console.log(`✓ Cleared ${existing.length} existing dinners`);
    }
    await db.insert(dinners).values(DEFAULT_DINNERS);
    console.log("✓ Dinners seeded");
  } else {
    console.log("• Dinners already present, skipping (use --force to overwrite)");
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
