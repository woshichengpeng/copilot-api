import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import type {
  GeminiFinishReason,
  GeminiGenerateContentResponse,
  GeminiPart,
  GeminiStreamState,
  GeminiUsageMetadata,
} from "./gemini-types"

import { mapOpenAIFinishReasonToGemini } from "./utils"

export function createStreamState(model: string): GeminiStreamState {
  return {
    accumulatedFunctionCalls: new Map(),
    model,
  }
}

export function translateChunkToGeminiResponse(
  chunk: ChatCompletionChunk,
  state: GeminiStreamState,
): GeminiGenerateContentResponse | null {
  if (chunk.choices.length === 0) {
    return null
  }

  const choice = chunk.choices[0]
  const { delta } = choice

  // Handle text delta
  const textParts = buildTextParts(delta.content)

  // Handle tool call deltas - accumulate them
  accumulateToolCalls(delta.tool_calls, state)

  // Handle finish
  if (choice.finish_reason) {
    return buildFinalChunk({
      finishReason: choice.finish_reason,
      textParts,
      chunk,
      state,
    })
  }

  // Regular chunk with content
  return buildContentChunk(textParts)
}

function buildTextParts(content: string | null | undefined): Array<GeminiPart> {
  if (!content) {
    return []
  }
  return [{ text: content }]
}

function accumulateToolCalls(
  toolCalls:
    | Array<{
        index: number
        id?: string
        type?: "function"
        function?: { name?: string; arguments?: string }
      }>
    | undefined,
  state: GeminiStreamState,
): void {
  if (!toolCalls) {
    return
  }

  for (const toolCall of toolCalls) {
    if (toolCall.id && toolCall.function?.name) {
      // New function call starting
      state.accumulatedFunctionCalls.set(toolCall.index, {
        id: toolCall.id,
        name: toolCall.function.name,
        args: toolCall.function.arguments ?? "",
      })
    } else if (toolCall.function?.arguments) {
      // Accumulating arguments
      const existing = state.accumulatedFunctionCalls.get(toolCall.index)
      if (existing) {
        existing.args += toolCall.function.arguments
      }
    }
  }
}

function buildFinalChunk(options: {
  finishReason: "stop" | "length" | "tool_calls" | "content_filter"
  textParts: Array<GeminiPart>
  chunk: ChatCompletionChunk
  state: GeminiStreamState
}): GeminiGenerateContentResponse {
  const { finishReason, textParts, chunk, state } = options
  const usage = buildUsageMetadata(chunk)
  const geminiFinishReason = mapOpenAIFinishReasonToGemini(finishReason)

  // If we have accumulated function calls, emit them
  if (state.accumulatedFunctionCalls.size > 0) {
    return buildFunctionCallResponse(geminiFinishReason, usage, state)
  }

  // Final chunk with text content (or empty)
  return buildTextResponse({
    parts: textParts,
    finishReason: geminiFinishReason,
    usage,
    model: state.model,
  })
}

function buildFunctionCallResponse(
  finishReason: GeminiFinishReason,
  usage: GeminiUsageMetadata,
  state: GeminiStreamState,
): GeminiGenerateContentResponse {
  const functionCallParts: Array<GeminiPart> = []

  for (const [, fc] of state.accumulatedFunctionCalls) {
    functionCallParts.push({
      functionCall: {
        id: fc.id,
        name: fc.name,
        args: parseToolCallArgs(fc.args),
      },
    })
  }

  return {
    candidates: [
      {
        content: { role: "model", parts: functionCallParts },
        finishReason,
        index: 0,
      },
    ],
    usageMetadata: usage,
    modelVersion: state.model,
  }
}

function buildTextResponse(options: {
  parts: Array<GeminiPart>
  finishReason: GeminiFinishReason
  usage: GeminiUsageMetadata
  model: string
}): GeminiGenerateContentResponse {
  const { parts, finishReason, usage, model } = options
  return {
    candidates: [
      {
        content: parts.length > 0 ? { role: "model", parts } : undefined,
        finishReason,
        index: 0,
      },
    ],
    usageMetadata: usage,
    modelVersion: model,
  }
}

function buildContentChunk(
  parts: Array<GeminiPart>,
): GeminiGenerateContentResponse | null {
  if (parts.length === 0) {
    return null
  }

  return {
    candidates: [
      {
        content: { role: "model", parts },
        index: 0,
      },
    ],
  }
}

function buildUsageMetadata(chunk: ChatCompletionChunk): GeminiUsageMetadata {
  return {
    promptTokenCount: chunk.usage?.prompt_tokens ?? 0,
    candidatesTokenCount: chunk.usage?.completion_tokens ?? 0,
    totalTokenCount: chunk.usage?.total_tokens ?? 0,
    cachedContentTokenCount: chunk.usage?.prompt_tokens_details?.cached_tokens,
  }
}

function parseToolCallArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return {}
  }
}
