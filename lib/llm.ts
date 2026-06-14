// Thin LLM provider wrapper.
//
// One function: `llm(input)` → structured response. Today the only implementation
// is Anthropic. The interface is intentionally provider-shaped (system + messages
// + tools + tool_choice + usage) so swapping in OpenAI, Gemini, or a local Ollama
// is a one-file change.
//
// Why this exists rather than just calling the SDK from each route:
//   1. Provider-agnostic by design — only this file knows about @anthropic-ai/sdk.
//   2. Single place to wire prompt-caching, tool-use, usage logging,
//      and error normalization.
//   3. Lets the agent dispatcher (/api/agent) and any future agent route
//      reuse one battle-tested call path.
//
// Adding a new provider: add a case to the `provider` switch and translate the
// generic `LlmInput` into that SDK's call shape. Keep the response shape stable.

import Anthropic from "@anthropic-ai/sdk";

export type LlmRole = "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string; // keep it simple: text-only messages for now
};

export type LlmTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export type LlmInput = {
  // The static, cacheable system prompt. First entry should be the most
  // stable content (family profile, etc.) so cache_control on it stays hot.
  systemBlocks: { text: string; cache?: boolean }[];
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  // Model is provider-neutral; the wrapper picks the right id per provider.
  // Use a friendly identifier like "sonnet-4-6" or "haiku-4-5".
  model?: "sonnet-4-6" | "haiku-4-5" | "opus-4-7";
  maxTokens?: number;
};

export type LlmToolUse = {
  type: "tool_use";
  name: string;
  input: unknown;
};

export type LlmText = {
  type: "text";
  text: string;
};

export type LlmResponse = {
  content: (LlmToolUse | LlmText)[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsed: string;
  provider: "anthropic";
};

export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

// --- Anthropic implementation ---

const ANTHROPIC_MODEL_IDS: Record<NonNullable<LlmInput["model"]>, string> = {
  "sonnet-4-6": "claude-sonnet-4-6",
  "haiku-4-5": "claude-haiku-4-5",
  "opus-4-7": "claude-opus-4-7",
};

async function callAnthropic(input: LlmInput): Promise<LlmResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LlmError(500, "ANTHROPIC_API_KEY not configured");
  }
  const client = new Anthropic();
  const modelId = ANTHROPIC_MODEL_IDS[input.model ?? "sonnet-4-6"];

  try {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: input.maxTokens ?? 4096,
      system: input.systemBlocks.map((b) => ({
        type: "text" as const,
        text: b.text,
        ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
      })),
      tools: input.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        // Anthropic's SDK types this strictly; the schema we hand it is JSON.
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
      tool_choice: input.toolChoice,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return {
      content: response.content
        .filter((b): b is Anthropic.ToolUseBlock | Anthropic.TextBlock => b.type === "tool_use" || b.type === "text")
        .map((b) => {
          if (b.type === "tool_use") return { type: "tool_use", name: b.name, input: b.input };
          return { type: "text", text: b.text };
        }),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
      },
      modelUsed: modelId,
      provider: "anthropic",
    };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new LlmError(err.status ?? 502, err.message);
    }
    throw new LlmError(500, err instanceof Error ? err.message : "Unknown LLM error");
  }
}

// --- Public entry point ---

export async function llm(input: LlmInput): Promise<LlmResponse> {
  // When a second provider lands, switch on env var like LLM_PROVIDER or on
  // a per-call override. For now: always Anthropic.
  return callAnthropic(input);
}
