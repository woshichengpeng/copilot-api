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
import {
  createMessages,
  type AnthropicResponse,
} from "~/services/copilot/create-messages"
import { getModelById, useMessagesApi } from "~/services/copilot/get-models"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

/**
 * Check if model should use native Messages API
 * Logic matches vscode-copilot-chat chatEndpoint.ts:233-236
 */
function shouldUseMessagesApi(modelId: string): boolean {
  const model = getModelById(modelId)
  if (model) {
    return useMessagesApi(model)
  }
  // No model info available - don't use native API
  return false
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Use native Messages API if model supports it (per supported_endpoints)
  if (shouldUseMessagesApi(anthropicPayload.model)) {
    consola.debug(
      "Using native Messages API for model:",
      anthropicPayload.model,
    )
    return handleNativeMessagesApi(c, anthropicPayload)
  }

  // For other models, translate to Chat Completions API
  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
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

const isNonStreamingMessagesApi = (
  response: Awaited<ReturnType<typeof createMessages>>,
): response is AnthropicResponse => Object.hasOwn(response, "content")

/**
 * Handle native Messages API passthrough for Claude models
 * Directly forwards request to Copilot /v1/messages endpoint
 */
async function handleNativeMessagesApi(
  c: Context,
  payload: AnthropicMessagesPayload,
) {
  const response = await createMessages(payload)

  // Non-streaming response - return directly
  if (isNonStreamingMessagesApi(response)) {
    consola.debug(
      "Non-streaming native messages response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    return c.json(response)
  }

  // Streaming response - passthrough SSE events
  consola.debug("Streaming native messages response from Copilot")

  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      consola.debug(
        "Copilot native messages stream event:",
        JSON.stringify(rawEvent),
      )

      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      // Parse and forward the event directly
      try {
        const event = JSON.parse(rawEvent.data) as AnthropicStreamEventData
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
