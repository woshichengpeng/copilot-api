import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
  AnthropicTextBlock,
} from "./anthropic-types"

const RESERVED_SYSTEM_PROMPT_LINE = /x-anthropic-billing-header\b/i

export function mapOpenAIStopReasonToAnthropic(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): AnthropicResponse["stop_reason"] {
  if (finishReason === null) {
    return null
  }
  const stopReasonMap = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "end_turn",
  } as const
  return stopReasonMap[finishReason]
}

export function sanitizeAnthropicSystem(
  system: AnthropicMessagesPayload["system"],
): AnthropicMessagesPayload["system"] {
  if (!system) {
    return system
  }

  if (typeof system === "string") {
    return sanitizeSystemText(system)
  }

  const cleanedBlocks = system
    .map((block) => ({
      ...block,
      text: sanitizeSystemText(block.text),
    }))
    .filter((block): block is AnthropicTextBlock => Boolean(block.text))

  return cleanedBlocks.length > 0 ? cleanedBlocks : undefined
}

export function normalizeAnthropicThinking(
  payload: AnthropicMessagesPayload,
): AnthropicMessagesPayload {
  if (!payload.thinking || payload.thinking.type !== "enabled") {
    return payload
  }

  const budgetTokens = payload.thinking.budget_tokens
  const minBudget = 1024

  if (payload.max_tokens <= budgetTokens) {
    // If max_tokens can't accommodate minimum budget (1024), disable thinking
    if (payload.max_tokens <= minBudget) {
      return {
        ...payload,
        thinking: undefined,
      }
    }

    // Clamp budget_tokens to max_tokens - 1, but ensure >= 1024
    const clampedBudget = Math.max(minBudget, payload.max_tokens - 1)
    return {
      ...payload,
      thinking: {
        type: "enabled",
        budget_tokens: clampedBudget,
      },
    }
  }

  // Ensure budget_tokens >= 1024 even if not exceeding max_tokens
  if (budgetTokens < minBudget) {
    return {
      ...payload,
      thinking: {
        type: "enabled",
        budget_tokens: minBudget,
      },
    }
  }

  return payload
}

function sanitizeSystemText(text: string): string | undefined {
  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => !RESERVED_SYSTEM_PROMPT_LINE.test(line))
    .join("\n")

  if (cleaned.trim().length === 0) {
    return undefined
  }

  return cleaned
}
