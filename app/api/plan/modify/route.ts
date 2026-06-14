import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { STORE_ORDER, ROUTE_PLAN, STAPLES, WEEKLY_TARGET, LAZY_IDEAS, MEDIUM_IDEAS, CROCK_IDEAS } from "@/lib/data";
import type { Dinner, Item } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAMILY_CONTEXT = `You are an AI meal-planning assistant for the Fosso family. You are given a note from the family about the upcoming week and the current state of their planner, and you propose changes — never apply them directly.

# The family
- Knute + Kait (adults), two young girls
- Gluten-free household; the adults are sometimes also dairy-free per meal (the girls are not GF/DF, but want healthy food)
- Potato-loving — potato-forward meals are a feature, not filler
- Always organic where it matters (protein especially); clean-eating, no-plastic, low-waste, glass-packaging-preferring
- Nightly banana + book ritual with the girls (bananas are a staple)
- Host Bible study Thursdays (host extras; can bake a treat to share)

## Per-person patterns
- Knute breakfast/lunch: high-protein only (protein powder + yogurt, mackerel/tuna tin, or dinner leftovers)
- Kait lunch: fresh or leftovers — GF/DF tuna plate or turkey roll-ups (no bread)
- Girls: grilled cheese, half-portions of Goodles mac, half-sandwiches, banana + book at night
- Girls' breakfast: Dutch baby ~1×/week, otherwise boiled eggs, oatmeal, yogurt

# Budget
- Weekly grocery target: $${WEEKLY_TARGET}/week (lean)
- Costco bulk run every 3 weeks for ~$200 (SEPARATE envelope — never fold into weekly)
- Coastal chicken feed roughly monthly (~$35, parked on Week 2)
- 3-week cycle: Week 1 normal · Week 2 + feed · Week 3 + bulk

# Stores + routing
${STORE_ORDER.map((k) => {
  const r = ROUTE_PLAN.find((rp) => rp.key === k);
  return `- ${k}: target $${r?.target ?? "?"} — ${r?.tip ?? ""}`;
}).join("\n")}

# Dinner tags (the schema you must use)
- crock — set-and-forget crock pot meal (Sunday default — chuck roast, leftovers feed Mon)
- left — leftovers from a prior crock/cook day (no shopping needed)
- lazy — UNDER 5 MIN PREP, MINIMAL DISHES. NOT German potatoes (peeling potatoes is medium). Assembly meals: nachos, burgers, tacos, bagged-salad + rotisserie chicken, etc.
- cook — real cook night (salmon + roasted potatoes, spaghetti, chicken alfredo)
- flex — flex/event night (Thursday Bible study, Saturday wildcard)

# Examples of the family's actual repeat meals
- Crock: chuck roast + potatoes & carrots
- Lazy: loaded nachos (ground beef + cheese + good refried beans), burger bowls + fries, tacos / quesadilla / burrito bowls, chicken Caesar salad (bagged + rotisserie), chicken + kale salad
- Medium/cook: salmon + roasted potatoes, tater tot casserole (green beans, tater tots, cream of mushroom, ground beef), spaghetti (GF pasta), chicken alfredo (GF pasta), chili with cornbread, egg casserole, German potatoes (vinegar, onion, beans, hot dogs)

# Idea bank pulls (for reference if you need to suggest something)
- LAZY_IDEAS: ${LAZY_IDEAS.join("; ")}
- MEDIUM_IDEAS: ${MEDIUM_IDEAS.join("; ")}
- CROCK_IDEAS: ${CROCK_IDEAS.join("; ")}
- STAPLES: ${STAPLES.join(", ")}

# How to propose changes
- Read the family's note carefully and respect it literally (cleanse weeks, special diets, guest hosting, etc.).
- Edit only what the note actually requires — leave other days alone unless the note implies a full reset.
- If the note implies eating differently (cleanse, fasting, special diet), use the skip flag with a meaningful reason rather than inventing meals.
- Shopping additions should be specific items the new plan needs that aren't already on the list. Use the store keys above (e.g. "fred", "grocout", "coop", "online"); if unsure, pick "fred" as the safe default.
- Keep meal text concise — the family glances at this on their phone. Match the style of their existing meals.
- Keep the tone encouraging and respectful of their values (organic, no-plastic, GF, etc.).

You will be told the current state and the family's note. Return your proposal by calling the propose_week_changes tool — do not respond conversationally. The family will see your summary + proposed changes and accept or reject.`;

type PlanModifyRequest = {
  note: string;
  dinners: Dinner[];
  items: Item[];
  currentWeek: number;
};

type DinnerChange = {
  day: string;
  meal: string;
  tag: string;
  label: string;
  note: string;
  skip: boolean;
  skipReason: string;
};

type ShoppingAddition = {
  name: string;
  store: string;
};

export type PlanProposal = {
  summary: string;
  dinner_changes: DinnerChange[];
  shopping_additions: ShoppingAddition[];
};

const VALID_TAGS = ["crock", "lazy", "cook", "left", "flex"];
const VALID_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: PlanModifyRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { note, dinners, items, currentWeek } = body;
  if (!note || typeof note !== "string" || note.trim().length === 0) {
    return NextResponse.json({ error: "Missing note" }, { status: 400 });
  }
  if (!Array.isArray(dinners) || !Array.isArray(items)) {
    return NextResponse.json({ error: "Missing dinners or items" }, { status: 400 });
  }

  const currentStateBlock = `# Current week
- Cycle week: ${currentWeek} of 3 (${currentWeek === 3 ? "bulk week" : currentWeek === 2 ? "feed week" : "normal week"})

# Current dinner rotation
${dinners.map((d) => `- ${d.day} [${d.tag}/${d.label}]${d.skip ? " (SKIPPED: " + (d.skipReason || "no reason") + ")" : ""}: ${d.meal}${d.note ? " — note: " + d.note : ""}`).join("\n")}

# Current shopping list (${items.length} items)
${items.length === 0 ? "(empty)" : items.map((i) => `- ${i.name} @ ${i.store}${i.done ? " (checked off)" : ""}`).join("\n")}

# The family's note
${note.trim()}`;

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      // Note: adaptive thinking is incompatible with tool_choice forcing a
      // specific tool. We force the tool to guarantee structured output, so
      // we trade off thinking — Sonnet 4.6 handles this structured-rewrite
      // task well without it.
      system: [
        {
          type: "text",
          text: FAMILY_CONTEXT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: "propose_week_changes",
          description:
            "Propose changes to the family's weekly meal plan and shopping list. The family will preview and accept or reject the proposal — do not apply directly.",
          input_schema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description:
                  "A short, friendly explanation (1-3 sentences) of what you're proposing and why, written for the family to read in the preview.",
              },
              dinner_changes: {
                type: "array",
                description:
                  "List of dinner-slot changes. Include ONLY the days you are changing — leave untouched days out of this array.",
                items: {
                  type: "object",
                  properties: {
                    day: {
                      type: "string",
                      enum: VALID_DAYS,
                      description: "Day of the week to modify.",
                    },
                    meal: {
                      type: "string",
                      description:
                        "New meal text for that day. Concise, phone-glanceable. Empty string if skipping the day.",
                    },
                    tag: {
                      type: "string",
                      enum: VALID_TAGS,
                      description: "crock | lazy | cook | left | flex",
                    },
                    label: {
                      type: "string",
                      description:
                        "Short label that displays next to the day (e.g. 'Crock pot', 'Lazy', 'Bible study', 'Real cook', 'Leftovers', 'Flex / out').",
                    },
                    note: {
                      type: "string",
                      description: "Optional short note. Empty string if none.",
                    },
                    skip: {
                      type: "boolean",
                      description: "True if this day should be skipped (no dinner needed).",
                    },
                    skipReason: {
                      type: "string",
                      description: "Reason for skipping (only meaningful if skip is true). Empty string otherwise.",
                    },
                  },
                  required: ["day", "meal", "tag", "label", "note", "skip", "skipReason"],
                  additionalProperties: false,
                },
              },
              shopping_additions: {
                type: "array",
                description:
                  "New items to add to the shopping list that the proposed plan requires. Leave empty if no additions needed.",
                items: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description: "Item name (e.g. 'organic kale', 'lemons').",
                    },
                    store: {
                      type: "string",
                      enum: STORE_ORDER,
                      description: "Best store key for this item. Default to 'fred' if unsure.",
                    },
                  },
                  required: ["name", "store"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "dinner_changes", "shopping_additions"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: "tool", name: "propose_week_changes" },
      messages: [
        {
          role: "user",
          content: currentStateBlock,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "Model did not return a tool call", raw: response.content },
        { status: 502 },
      );
    }

    const proposal = toolUse.input as PlanProposal;

    return NextResponse.json({
      proposal,
      usage: response.usage,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic API error ${err.status}: ${err.message}` },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
