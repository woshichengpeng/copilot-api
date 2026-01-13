import { randomBytes } from "node:crypto"

import type { GeminiFinishReason } from "./gemini-types"

/**
 * Map Gemini model names to Copilot-supported equivalents.
 * The Gemini CLI may request models that aren't available on Copilot,
 * so we map them to the closest available alternative.
 */
const MODEL_MAPPING: Record<string, string> = {
  // Flash lite models -> map to flash preview
  "gemini-2.5-flash-lite": "gemini-3-flash-preview",
  "gemini-2.0-flash-lite": "gemini-3-flash-preview",
  "gemini-1.5-flash-lite": "gemini-3-flash-preview",
  // Flash models -> map to flash preview
  "gemini-2.5-flash": "gemini-3-flash-preview",
  "gemini-2.0-flash": "gemini-3-flash-preview",
  "gemini-1.5-flash": "gemini-3-flash-preview",
  // Pro models -> map to pro preview or 2.5-pro
  "gemini-1.5-pro": "gemini-2.5-pro",
  "gemini-2.0-pro": "gemini-2.5-pro",
  "gemini-3-pro": "gemini-3-pro-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
}

export function mapGeminiModel(model: string): string {
  return MODEL_MAPPING[model] ?? model
}

export function mapOpenAIFinishReasonToGemini(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): GeminiFinishReason {
  if (!finishReason) {
    return "FINISH_REASON_UNSPECIFIED"
  }

  switch (finishReason) {
    case "stop": {
      return "STOP"
    }
    case "length": {
      return "MAX_TOKENS"
    }
    case "tool_calls": {
      return "STOP" // Gemini uses STOP for function calls too
    }
    case "content_filter": {
      return "SAFETY"
    }
    default: {
      return "OTHER"
    }
  }
}

export function extractModelFromPath(modelWithMethod: string): string {
  // "gemini-1.5-pro:generateContent" -> "gemini-1.5-pro"
  // "gpt-4o:streamGenerateContent" -> "gpt-4o"
  const colonIndex = modelWithMethod.lastIndexOf(":")
  if (colonIndex === -1) {
    return modelWithMethod
  }
  return modelWithMethod.slice(0, colonIndex)
}

export function generateToolCallId(functionName: string): string {
  return `call_${functionName}_${randomBytes(8).toString("hex")}`
}
