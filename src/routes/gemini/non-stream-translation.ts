import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import type { GeminiGenerateContentResponse, GeminiPart } from "./gemini-types"

import { mapOpenAIFinishReasonToGemini } from "./utils"

export function translateToGemini(
  response: ChatCompletionResponse,
  model: string,
): GeminiGenerateContentResponse {
  const choice = response.choices[0]
  const parts = buildContentParts(choice.message)
  const finishReason = mapOpenAIFinishReasonToGemini(choice.finish_reason)

  return {
    candidates: [
      {
        content:
          parts.length > 0 ?
            {
              role: "model",
              parts,
            }
          : undefined,
        finishReason,
        index: 0,
      },
    ],
    usageMetadata: buildUsageMetadata(response),
    modelVersion: model,
  }
}

function buildContentParts(message: {
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
}): Array<GeminiPart> {
  const parts: Array<GeminiPart> = []

  // Handle text content
  if (message.content) {
    parts.push({ text: message.content })
  }

  // Handle tool calls -> functionCall parts
  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      parts.push({
        functionCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          args: parseToolCallArgs(toolCall.function.arguments),
        },
      })
    }
  }

  return parts
}

function parseToolCallArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return {}
  }
}

function buildUsageMetadata(response: ChatCompletionResponse) {
  return {
    promptTokenCount: response.usage?.prompt_tokens ?? 0,
    candidatesTokenCount: response.usage?.completion_tokens ?? 0,
    totalTokenCount: response.usage?.total_tokens ?? 0,
    cachedContentTokenCount:
      response.usage?.prompt_tokens_details?.cached_tokens,
  }
}
