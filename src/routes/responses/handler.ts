import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createResponses } from "~/services/copilot/create-responses"
import { getModelById, useResponsesApi } from "~/services/copilot/get-models"

import type {
  ResponseAPIPayload,
  ResponseAPIResponse,
  ResponseAPIStreamState,
} from "./response-api-types"

import { translateToResponseAPI } from "./non-stream-translation"
import { translateToOpenAI } from "./request-translation"
import {
  buildInitialResponse,
  createStreamState,
  translateChunkToEvents,
} from "./stream-translation"

/**
 * Check if model should use native Response API
 * Logic matches vscode-copilot-chat chatEndpoint.ts:222-231
 */
function shouldUseResponsesApi(modelId: string): boolean {
  const model = getModelById(modelId)
  if (model) {
    return useResponsesApi(model)
  }
  // No model info available - don't use native API
  return false
}

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponseAPIPayload>()
  consola.debug("Response API request payload:", JSON.stringify(payload))

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Use native Response API if model supports it (per supported_endpoints)
  if (shouldUseResponsesApi(payload.model)) {
    consola.debug("Using native Response API for model:", payload.model)
    return handleNativeResponsesApi(c, payload)
  }

  // For other models, translate to Chat Completions API
  const openAIPayload = translateToOpenAI(payload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  const response = await createChatCompletions(openAIPayload)

  // Non-streaming response
  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )

    const responseAPIResponse = translateToResponseAPI(response, payload)
    consola.debug(
      "Translated Response API response:",
      JSON.stringify(responseAPIResponse),
    )

    return c.json(responseAPIResponse)
  }

  // Streaming response
  consola.debug("Streaming response from Copilot")

  return streamSSE(c, async (stream) => {
    let streamState: ResponseAPIStreamState | null = null
    let firstChunk = true

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))

      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk

      // Initialize stream state on first chunk
      if (firstChunk) {
        streamState = createStreamState(payload, chunk)

        // Emit response.created event
        const createdEvent = {
          type: "response.created",
          response: buildInitialResponse(streamState),
        }
        await stream.writeSSE({
          event: createdEvent.type,
          data: JSON.stringify(createdEvent),
        })

        // Emit response.in_progress event
        const inProgressEvent = {
          type: "response.in_progress",
          response: buildInitialResponse(streamState),
        }
        await stream.writeSSE({
          event: inProgressEvent.type,
          data: JSON.stringify(inProgressEvent),
        })

        firstChunk = false
      }

      if (!streamState) {
        continue
      }

      const events = translateChunkToEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Response API event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isNonStreamingResponseApi = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponseAPIResponse => Object.hasOwn(response, "output")

/**
 * Handle native Response API passthrough for codex models
 * Directly forwards request to Copilot /responses endpoint
 */
async function handleNativeResponsesApi(
  c: Context,
  payload: ResponseAPIPayload,
) {
  const response = await createResponses(payload)

  // Non-streaming response - return directly
  if (isNonStreamingResponseApi(response)) {
    consola.debug(
      "Non-streaming native response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    return c.json(response)
  }

  // Streaming response - passthrough SSE events
  consola.debug("Streaming native response from Copilot")

  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      consola.debug("Copilot native stream event:", JSON.stringify(rawEvent))

      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      // Parse and forward the event directly
      try {
        const event = JSON.parse(rawEvent.data) as { type: string }
        await stream.writeSSE({
          event: event.type,
          data: rawEvent.data,
        })
      } catch {
        consola.warn("Failed to parse stream event, skipping:", rawEvent.data)
      }
    }
  })
}
