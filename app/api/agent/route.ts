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
import { agentProposals } from "@/db/schema";
import { FAMILY_NARRATIVE, TONE } from "@/lib/familyProfile";
import { STORE, STORE_ORDER, ROUTE_PLAN, STAPLES, LAZY_IDEAS, MEDIUM_IDEAS, CROCK_IDEAS } from "@/lib/data";
import { llm, LlmError } from "@/lib/llm";
import { getTool, type AgentToolName, type ModifyWeekProposal, type RecipeProposal } from "@/lib/agentTools";
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

  const userContent = buildToolContext(body, { recipeText });

  try {
    const response = await llm({
      model: "sonnet-4-6",
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
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "Model did not return a tool call", raw: response.content },
        { status: 502 },
      );
    }

    const proposalData = toolUse.input as ModifyWeekProposal | RecipeProposal;

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
