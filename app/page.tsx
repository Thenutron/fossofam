import Planner from "@/components/Planner";
import { getAllState } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { items, dinners, expenses, household } = await getAllState();
  return (
    <Planner
      initialItems={items}
      initialDinners={dinners}
      initialExpenses={expenses}
      initialHousehold={household}
    />
  );
}
