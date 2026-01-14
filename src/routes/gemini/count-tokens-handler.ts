import type { Context } from "hono"

import consola from "consola"

import type {
  GeminiContent,
  GeminiCountTokensResponse,
  GeminiGenerateContentRequest,
} from "./gemini-types"

import { isTextPart } from "./gemini-types"
import { extractModelFromPath, mapGeminiModel } from "./utils"

// Cache the encoder to avoid repeated imports
let cachedEncoder: { encode: (text: string) => Array<number> } | null = null
let encoderPromise: Promise<{
  encode: (text: string) => Array<number>
}> | null = null

async function getEncoder() {
  if (cachedEncoder) {
    return cachedEncoder
  }
  if (encoderPromise) {
    return encoderPromise
  }
  encoderPromise = import("gpt-tokenizer/encoding/o200k_base").then(
    (module) => {
      cachedEncoder = module as { encode: (text: string) => Array<number> }
      return cachedEncoder
    },
  )
  return encoderPromise
}

/**
 * Extract all text from a GeminiContent object
 */
function extractTextFromContent(content: GeminiContent): string {
  const textParts: Array<string> = []
  for (const part of content.parts) {
    if (isTextPart(part)) {
      textParts.push(part.text)
    }
  }
  return textParts.join("")
}

/**
 * Handles token counting for Gemini API requests
 */
export async function handleCountTokens(c: Context) {
  const modelWithMethod = c.req.param("modelWithMethod")
  const model = mapGeminiModel(extractModelFromPath(modelWithMethod))

  const geminiPayload = await c.req.json<GeminiGenerateContentRequest>()

  const encoder = await getEncoder()

  let totalTokens = 0

  // Count tokens in systemInstruction if present
  if (geminiPayload.systemInstruction) {
    const systemText = extractTextFromContent(geminiPayload.systemInstruction)
    totalTokens += encoder.encode(systemText).length
  }

  // Count tokens in contents array
  for (const content of geminiPayload.contents) {
    const text = extractTextFromContent(content)
    totalTokens += encoder.encode(text).length
  }

  consola.info(`Gemini token count for ${model}: ${totalTokens}`)

  const response: GeminiCountTokensResponse = {
    totalTokens,
  }

  return c.json(response)
}
