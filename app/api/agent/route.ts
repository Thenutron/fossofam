// /api/agent — single agent dispatcher endpoint.
//
// Takes a freeform note + an explicit `tool` to run + the current state, then:
//   1. Loads the family profile (canonical narrative) as a CACHED system block.
//   2. Loads the tool's schema from the agentTools registry.
//   3. Builds module-specific context block (current dinners, items, current week).
//   4. Calls llm() with forced tool_choice.
//   5. Logs everything to agent_proposals.
//   6. Returns the typed proposal to the client.
//
// New tools: register in lib/agentTools.ts, add a `buildContext` branch here.
// New agent surfaces (proactive cron, post-action suggestions): import llm()
// and AGENT_TOOLS directly from here-style code.

import { NextResponse } from "next/server";
import { db } from "@/db";
import { agentProposals, recipes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { FAMILY_NARRATIVE, TONE } from "@/lib/familyProfile";
import { STORE, STORE_ORDER, ROUTE_PLAN, STAPLES, LAZY_IDEAS, MEDIUM_IDEAS, CROCK_IDEAS } from "@/lib/data";
import { llm, LlmError, type LlmImageMediaType } from "@/lib/llm";
import { getTool, type AgentToolName, type ModifyWeekProposal, type RecipeProposal, type ReceiptProposal, type PlanShoppingProposal, type ModifyRecipeProposal, type SuggestMealProposal } from "@/lib/agentTools";
import type { Dinner, Item } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

// The static, cacheable context every agent call sees: family narrative +
// grocery routing knowledge + meal-tag schema. Built once at module load.
// (No timestamps or per-request data — keeps the prompt-cache prefix stable.)
const STATIC_CONTEXT = `${FAMILY_NARRATIVE}

${TONE}

# Stores — name, target spend, family's real take, agent tip
${STORE_ORDER.map((k) => {
  const r = ROUTE_PLAN.find((rp) => rp.key === k);
  const s = STORE[k];
  return `- ${k} (${s?.name}, target $${r?.target ?? "?"}): ${s?.note ?? ""} | ${r?.tip ?? ""}`;
}).join("\n")}

# Dinner tag schema
- crock — set-and-forget crock pot meal (Sunday default — chuck roast, leftovers feed Mon)
- left — leftovers from a prior crock/cook day (no shopping needed)
- lazy — UNDER 5 MIN PREP, MINIMAL DISHES. NOT German potatoes (peeling potatoes is medium). Assembly meals: nachos, burgers, tacos, bagged-salad + rotisserie chicken, etc.
- cook — real cook night (salmon + roasted potatoes, spaghetti, chicken alfredo)
- flex — flex/event night (Thursday Bible study, Saturday wildcard)

# Family's actual repeat meals (the rotation seed)
- Crock: chuck roast + potatoes & carrots
- Lazy: loaded nachos (ground beef + cheese + good refried beans), burger bowls + fries, tacos/quesadilla/burrito bowls, chicken Caesar salad (bagged + rotisserie), chicken + kale salad
- Medium/cook: salmon + roasted potatoes, tater tot casserole (green beans, tater tots, cream of mushroom, ground beef), spaghetti (GF pasta), chicken alfredo (GF pasta), chili with cornbread, egg casserole, German potatoes (vinegar, onion, beans, hot dogs)

# Idea bank references
- LAZY_IDEAS: ${LAZY_IDEAS.join("; ")}
- MEDIUM_IDEAS: ${MEDIUM_IDEAS.join("; ")}
- CROCK_IDEAS: ${CROCK_IDEAS.join("; ")}
- STAPLES: ${STAPLES.join(", ")}

# Behavior
- Read the family's note literally. Respect cleanse weeks, special diets, guest hosting, etc.
- Edit only what the note requires — don't gratuitously change days that aren't affected.
- Keep meal text concise — the family glances on their phone.
- Honor the tone block above.
- Thursday Bible study: they HOST but do NOT cook for guests. Decaf + snacks; a baked treat is occasional/optional. Do NOT plan Thursday meals around feeding extras.
- BUDGET RULE: every modify_week proposal must include estimated_weekly_cost + budget_status. If the proposal would push over $215, you must propose a 'scrounge night' day (pantry + leftovers, no shopping). Frame the scrounge in the tone block's voice — "scrounge night era", "pantry raid", not preachy.
- Per-person preferences are LOAD-BEARING. Kait + Revs don't do shellfish/exotic seafood. Knute + Havyn do. Recipes and plans must respect this.
- Return your proposal by calling the tool you've been instructed to use. Do not respond conversationally.`;

type AgentRequest = {
  tool: AgentToolName;
  note: string;
  // Optional state blocks — only the relevant ones for the chosen tool.
  dinners?: Dinner[];
  items?: Item[];
  currentWeek?: number;
  // For get_recipe specifically
  meal?: string;
  kind?: string; // "crock" | "lazy" | "cook" | "left" | "flex" | "bake" | "dinner"
  // For import_recipe specifically
  url?: string;
  // For parse_receipt specifically — base64 JPEG/PNG sans the data: prefix.
  imageBase64?: string;
  imageMediaType?: string;
  // For plan_shopping — the user's anchor store for this week. Items get
  // routed here whenever possible; only divert when something truly isn't
  // carried there.
  anchorStore?: string;
  // For get_recipe — when true, bypass the cache and regenerate from scratch.
  forceFresh?: boolean;
  // For modify_recipe — the existing recipe payload to mutate.
  currentRecipe?: Record<string, unknown>;
  // For suggest_meal — which day of the week to generate for.
  day?: string;
};

// Strip HTML to readable text for the LLM. Good-enough heuristic for the
// blog-post-style recipe pages we'll see. Caps at 20K chars to keep token
// cost reasonable (recipe sites are mostly cruft around the actual recipe).
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

async function fetchRecipeText(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must be http(s)");
  }
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FossoMealPlanner/1.0; +https://fossofam.vercel.app)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Recipe page returned ${res.status}`);
  const html = await res.text();
  return htmlToText(html);
}

function buildToolContext(req: AgentRequest, extras?: { recipeText?: string }): string {
  if (req.tool === "modify_week") {
    const dinners = req.dinners ?? [];
    const items = req.items ?? [];
    const cw = req.currentWeek ?? 1;
    return `# Current week
Cycle week: ${cw} of 3 (${cw === 3 ? "bulk week" : cw === 2 ? "feed week" : "normal week"})

# Current dinner rotation
${dinners.map((d) => `- ${d.day} [${d.tag}/${d.label}]${d.skip ? " (SKIPPED: " + (d.skipReason || "no reason") + ")" : ""}: ${d.meal}${d.note ? " — note: " + d.note : ""}`).join("\n")}

# Current shopping list (${items.length} items)
${items.length === 0 ? "(empty)" : items.map((i) => `- ${i.name} @ ${i.store}${i.done ? " (checked off)" : ""}`).join("\n")}

# The family's note
${req.note.trim()}`;
  }
  if (req.tool === "get_recipe") {
    return `# Recipe request
Meal: ${req.meal ?? "(unspecified)"}
Effort tier: ${req.kind ?? "dinner"}

# Notes from the family
${req.note?.trim() || "(none — use defaults)"}

Return a complete, family-scaled recipe via the get_recipe tool.`;
  }
  if (req.tool === "import_recipe") {
    return `# Recipe page text (extracted from ${req.url ?? "(no url)"})

${extras?.recipeText ?? "(no text — fetch failed)"}

# Notes from the family
${req.note?.trim() || "(none)"}

Extract the actual recipe from the page text above. Ignore the blog narrative, ads, comments, related-recipe links. Suggest a day to slot it into based on its effort, propose shopping_additions only for ingredients the family probably doesn't already have, and flag any family_fit_warnings (especially shellfish for Kait/Revs).`;
  }
  if (req.tool === "suggest_meal") {
    const dinners = req.dinners ?? [];
    const items = req.items ?? [];
    const pricedItems = items.filter((i) => i.cost != null && i.cost > 0);
    return `# Request
Day: ${req.day || "(any)"}
Effort tier: ${req.kind || "dinner"}

# Current week's rotation (DO NOT propose duplicates of these)
${dinners.map((d) => `- ${d.day}: ${d.meal}${d.tag ? " [" + d.tag + "]" : ""}`).join("\n")}

# Historical item prices (use to ground est_cost when relevant)
${pricedItems.length === 0 ? "(no priced history yet)" : pricedItems.map((i) => `- ${i.name}: $${i.cost!.toFixed(2)}`).join("\n")}

# Family note
${req.note?.trim() || "(none)"}

Return ONE specific meal idea via suggest_meal with an honest est_cost.`;
  }
  if (req.tool === "modify_recipe") {
    const current = req.currentRecipe ?? {};
    return `# Current recipe (preserve structure unless the change calls for it)
${JSON.stringify(current, null, 2)}

# Family modification request
${req.note?.trim() || "(none — return the recipe unchanged)"}

Return an updated recipe via modify_recipe. Make ONLY the changes the family asked for — don't gratuitously rewrite. Respect GF household + per-person preferences. Always include a change_summary in the family's tone.`;
  }
  if (req.tool === "plan_shopping") {
    const dinners = req.dinners ?? [];
    const items = req.items ?? [];
    const cw = req.currentWeek ?? 1;
    const anchor = req.anchorStore && STORE[req.anchorStore] ? req.anchorStore : "";
    const anchorBlock = anchor
      ? `# Anchor store
The family is anchoring this week's run at: ${STORE[anchor].name} (${anchor}).
ROUTING RULE: route every item to '${anchor}' UNLESS the store list above flags it as not carried there. Examples that should NOT go to '${anchor}': raw milk (→ coop or rawmilk pickup), chicken feed (→ coastal), mold-free coffee (→ sprouts or online). Everything else: ${anchor}.`
      : `# Anchor store
The family has not picked an anchor this week. Use the default store-per-item routing.`;
    return `# Current week
Cycle week: ${cw} of 3 (${cw === 3 ? "bulk week" : cw === 2 ? "feed week" : "normal week"})
Weekly budget target: $215

${anchorBlock}

# Current 7-day dinner plan
${dinners.map((d) => `- ${d.day} [${d.tag}/${d.label}]${d.skip ? " (SKIPPED — ignore this day)" : ""}: ${d.meal || "(blank — ignore this day)"}${d.note ? " — note: " + d.note : ""}`).join("\n")}

# Already on the shopping list (DO NOT propose duplicates of these)
${items.length === 0
  ? "(list is empty)"
  : items.map((i) => `- ${i.name}${i.cost != null ? ` (last paid $${i.cost.toFixed(2)})` : ""}`).join("\n")}

${req.note?.trim() ? `# Family note for this build (HONOR LITERALLY — special diets, leftovers to use, things to skip)\n${req.note.trim()}\n` : ""}

# Task
For each non-skipped, non-blank dinner above, list everything the family needs to BUY to make it. Output via plan_shopping. Skip dupes against the existing list. Skip basic pantry items (oil, salt, pepper, common spices, flour, sugar, butter, garlic powder; eggs/milk only if a meal uses a big quantity). Use the store enum's keys for the 'store' field (e.g. 'fred', 'grocout', 'sprouts'). Use 'for_meal' to give the family a 1-line reason (e.g. 'Sun crock', 'Tue tacos + Wed burgers').

ORGANIC DEFAULT: Every shopping_addition name MUST be prefixed with 'Organic' when applicable — produce, meat, poultry, fish, dairy, eggs, and most pantry items. Examples: 'Organic ground beef', 'Organic honeycrisp apples', 'Organic kale', 'Organic chicken breast', 'Organic salmon'. Only skip the 'Organic' prefix when (a) it's a specific non-organic brand the family already buys (Goodles mac & cheese, Tillamook block cheese — they're already premium), or (b) the item genuinely isn't sold organic. When in doubt, prefix Organic.

For est_cost: ground in any 'last paid' prices above when an analogous item exists, otherwise estimate from typical PNW grocery prices at the ORGANIC price point. Sum your est_costs into estimated_weekly_cost (round to whole dollars). Compare against the $215 target → budget_status. If over: propose a scrounge_suggestion day swap in the family's voice.

NO LONG NOTES. Don't write paragraphs of conditional reasoning like "(1) chili powder — if running low, otherwise skip…". Instead, surface those as short yes/no questions[] (≤4) that directly control which items get unchecked. The notes field is reserved for caveats you can't ask about, max 1 sentence.`;
  }
  if (req.tool === "parse_receipt") {
    const items = req.items ?? [];
    return `# Cart (what's currently on the family's shopping list)
${items.length === 0
  ? "(empty — everything on the receipt is receipt_only)"
  : items.map((i) => `- id=${i.id} "${i.name}" @ ${i.store}${i.cost != null ? ` (current cost: $${i.cost})` : ""}${i.done ? " [checked]" : ""}`).join("\n")}

# Task
The attached image is a grocery receipt. Reconcile it against the cart above.

1. Read the store name from the header and the grand total at the bottom.
2. For each line item on the receipt, match it to the closest cart item by id. Be lenient — receipts use abbreviations (GRD BF → ground beef, OG/ORG → organic, GS → granny smith, single-letter prefixes are produce-code).
3. If a receipt line doesn't match anything in the cart, put it under receipt_only with a CLEANED name (expand abbreviations) and the best store guess from the enum.
4. If a cart item isn't on the receipt, put it under cart_only.
5. If the photo is blurry/unreadable, return store='unknown', total=0, empty arrays, and explain in notes.

${req.note?.trim() ? `# Family note\n${req.note.trim()}\n` : ""}`;
  }
  return req.note.trim();
}

export async function POST(req: Request) {
  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.tool) {
    return NextResponse.json({ error: "Missing `tool` field" }, { status: 400 });
  }

  let tool;
  try {
    tool = getTool(body.tool);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown tool" }, { status: 400 });
  }

  // For import_recipe, fetch the URL server-side and inline the page text.
  let recipeText: string | undefined;
  if (body.tool === "import_recipe") {
    if (!body.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "import_recipe requires `url`" }, { status: 400 });
    }
    try {
      recipeText = await fetchRecipeText(body.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch URL";
      return NextResponse.json({ error: `Couldn't fetch the recipe page: ${msg}` }, { status: 502 });
    }
  }

  // get_recipe cache short-circuit. If we've seen this exact meal before
  // and the caller didn't request a fresh regen, return the cached payload
  // immediately. Saves ~$0.005 + a 5-10s wait per repeat tap.
  if (body.tool === "get_recipe" && body.meal && !body.forceFresh) {
    const c = body.meal.trim().toLowerCase().replace(/\s+/g, " ");
    if (c) {
      try {
        const [hit] = await db.select().from(recipes).where(eq(recipes.mealCanonical, c)).limit(1);
        if (hit) {
          // Bump usage stats async — don't block the response.
          db.update(recipes)
            .set({ usedCount: sql`${recipes.usedCount} + 1`, lastUsedAt: new Date() })
            .where(eq(recipes.id, hit.id))
            .catch(() => {});
          return NextResponse.json({
            proposalId: undefined,
            tool: "get_recipe",
            proposal: hit.payload,
            cached: true,
            model: "cache",
          });
        }
      } catch (cacheErr) {
        console.error("Recipe cache lookup failed:", cacheErr);
        // Fall through to LLM path on cache error.
      }
    }
  }

  // parse_receipt needs an image. Reject early with a clear message rather
  // than burning a model call on an empty multimodal payload.
  if (body.tool === "parse_receipt") {
    if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
      return NextResponse.json({ error: "parse_receipt requires `imageBase64`" }, { status: 400 });
    }
    if (!body.imageMediaType || !/^image\/(jpeg|png|webp|gif)$/.test(body.imageMediaType)) {
      return NextResponse.json({ error: "parse_receipt requires a JPEG/PNG/WEBP/GIF imageMediaType" }, { status: 400 });
    }
  }

  const userContent = buildToolContext(body, { recipeText });

  try {
    const userMessage = body.tool === "parse_receipt" && body.imageBase64 && body.imageMediaType
      ? {
          role: "user" as const,
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: body.imageMediaType as LlmImageMediaType,
                data: body.imageBase64,
              },
            },
            { type: "text" as const, text: userContent },
          ],
        }
      : { role: "user" as const, content: userContent };

    // Haiku for most things — fast + cheap + plenty good for these tools.
    // Sonnet stays the choice for parse_receipt (vision OCR quality matters).
    const modelForCall = body.tool === "parse_receipt" ? "sonnet-4-6" : "haiku-4-5";
    const response = await llm({
      model: modelForCall,
      maxTokens: 4096,
      // Two system blocks: the big stable one is cached; the small per-tool
      // hint is appended uncached so swapping tools doesn't invalidate the
      // family-context cache.
      systemBlocks: [
        { text: STATIC_CONTEXT, cache: true },
        { text: `For this call you must use the \`${tool.name}\` tool. ${tool.description}`, cache: false },
      ],
      tools: [tool],
      toolChoice: { type: "tool", name: tool.name },
      messages: [userMessage],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "Model did not return a tool call", raw: response.content },
        { status: 502 },
      );
    }

    const proposalData = toolUse.input as ModifyWeekProposal | RecipeProposal | ReceiptProposal | PlanShoppingProposal | ModifyRecipeProposal | SuggestMealProposal;

    // Cache the recipe for future calls so we don't regenerate the same meal.
    if (body.tool === "get_recipe" && body.meal) {
      const c = body.meal.trim().toLowerCase().replace(/\s+/g, " ");
      if (c) {
        db.insert(recipes)
          .values({
            mealCanonical: c,
            mealName: body.meal.trim(),
            kind: body.kind ?? null,
            payload: proposalData as unknown as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: recipes.mealCanonical,
            set: {
              payload: proposalData as unknown as Record<string, unknown>,
              kind: body.kind ?? null,
              lastUsedAt: new Date(),
            },
          })
          .catch((e) => console.error("Recipe cache write failed:", e));
      }
    }

    // Log to agent_proposals (best-effort — don't block the response on it).
    let proposalId: number | undefined;
    try {
      const [row] = await db
        .insert(agentProposals)
        .values({
          tool: body.tool,
          model: response.modelUsed,
          inputNote: body.note ?? "",
          inputContext: {
            dinners: body.dinners,
            items: body.items,
            currentWeek: body.currentWeek,
            meal: body.meal,
            kind: body.kind,
          },
          output: proposalData as unknown as Record<string, unknown>,
          status: "proposed",
          usageInputTokens: response.usage.input_tokens,
          usageOutputTokens: response.usage.output_tokens,
          usageCacheReadTokens: response.usage.cache_read_input_tokens ?? null,
        })
        .returning({ id: agentProposals.id });
      proposalId = row?.id;
    } catch (logErr) {
      // Surface but don't fail the request.
      console.error("Failed to log agent proposal:", logErr);
    }

    return NextResponse.json({
      proposalId,
      tool: body.tool,
      proposal: proposalData,
      usage: response.usage,
      model: response.modelUsed,
    });
  } catch (err) {
    if (err instanceof LlmError) {
      return NextResponse.json({ error: `LLM error ${err.status}: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
