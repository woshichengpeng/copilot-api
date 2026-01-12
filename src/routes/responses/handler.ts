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

import type {
  ResponseAPIPayload,
  ResponseAPIStreamState,
} from "./response-api-types"

import { translateToResponseAPI } from "./non-stream-translation"
import { translateToOpenAI } from "./request-translation"
import {
  buildInitialResponse,
  createStreamState,
  translateChunkToEvents,
} from "./stream-translation"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponseAPIPayload>()
  consola.debug("Response API request payload:", JSON.stringify(payload))

  const openAIPayload = translateToOpenAI(payload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

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
