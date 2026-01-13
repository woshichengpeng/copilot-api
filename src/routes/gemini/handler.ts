import type { Context } from "hono"

import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import type { GeminiGenerateContentRequest } from "./gemini-types"

import { translateToGemini } from "./non-stream-translation"
import { translateToOpenAI } from "./request-translation"
import {
  createStreamState,
  translateChunkToGeminiResponse,
} from "./stream-translation"
import { extractModelFromPath, mapGeminiModel } from "./utils"

export async function handleGenerateContent(c: Context) {
  await checkRateLimit(state)

  const modelWithMethod = c.req.param("modelWithMethod")
  const model = mapGeminiModel(extractModelFromPath(modelWithMethod))

  const geminiPayload = await c.req.json<GeminiGenerateContentRequest>()
  const openAIPayload = translateToOpenAI(geminiPayload, model, false)

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    const geminiResponse = translateToGemini(response, model)
    return c.json(geminiResponse)
  }

  // Should not reach here for generateContent (non-streaming)
  throw new Error("Unexpected streaming response for non-streaming request")
}

export async function handleStreamGenerateContent(c: Context) {
  await checkRateLimit(state)

  const modelWithMethod = c.req.param("modelWithMethod")
  const model = mapGeminiModel(extractModelFromPath(modelWithMethod))

  const geminiPayload = await c.req.json<GeminiGenerateContentRequest>()
  const openAIPayload = translateToOpenAI(geminiPayload, model, true)

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    throw new Error("Expected streaming response but got non-streaming")
  }

  // Gemini uses SSE with data: {json}\r\n\r\n format
  return streamSSE(c, async (stream) => {
    const streamState = createStreamState(model)

    for await (const rawEvent of response) {
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const geminiChunk = translateChunkToGeminiResponse(chunk, streamState)

      if (geminiChunk) {
        // Gemini SSE format: just data, no event type
        await stream.writeSSE({
          data: JSON.stringify(geminiChunk),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
