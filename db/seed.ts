import { db } from "./index";
import { dinners, household, people } from "./schema";
import { DEFAULT_DINNERS } from "../lib/data";
import { PEOPLE } from "../lib/familyProfile";

async function seed() {
  const force = process.argv.includes("--force");
  console.log(force ? "Seeding (force)…" : "Seeding…");

  // Dinners
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

  // Household singleton
  const hh = await db.select().from(household);
  if (hh.length === 0) {
    await db.insert(household).values({ id: 1, currentWeek: 1, lastWeekTotal: null });
    console.log("✓ Household row created");
  } else {
    console.log("• Household row already present, skipping");
  }

  // People — seeded from familyProfile.PEOPLE. Idempotent on `key`.
  const existingPeople = await db.select().from(people);
  if (existingPeople.length === 0 || force) {
    if (existingPeople.length > 0 && force) {
      await db.delete(people);
      console.log(`✓ Cleared ${existingPeople.length} existing people`);
    }
    await db.insert(people).values(
      PEOPLE.map((p, i) => ({
        key: p.key,
        name: p.name,
        role: p.role,
        dietary: p.dietary.join(", "),
        notes: p.patterns.notes ?? "",
        sortOrder: i,
      })),
    );
    console.log(`✓ Seeded ${PEOPLE.length} people`);
  } else {
    console.log("• People already present, skipping (use --force to overwrite)");
  }

  console.log("Done.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
