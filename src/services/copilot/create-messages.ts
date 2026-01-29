import consola from "consola"
import { events } from "fetch-event-stream"
import { writeFileSync } from "node:fs"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Re-export for convenience

interface CreateMessagesOptions {
  anthropicBeta?: string
  originalPayload?: unknown
  originalHeaders?: Record<string, string>
}

/**
 * Directly call Copilot backend /v1/messages endpoint
 * Used for models that support native Anthropic Messages API
 */
export const createMessages = async (
  payload: AnthropicMessagesPayload,
  options: CreateMessagesOptions = {},
) => {
  const { anthropicBeta, originalPayload, originalHeaders } = options
  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Check for vision content
  const enableVision = payload.messages.some(
    (msg) =>
      Array.isArray(msg.content)
      && msg.content.some((block) => "type" in block && block.type === "image"),
  )

  // Agent/user check for X-Initiator header
  // Check for assistant messages or tool-related content
  const isAgentCall = payload.messages.some(
    (msg) =>
      msg.role === "assistant"
      || (Array.isArray(msg.content)
        && msg.content.some(
          (block) => "type" in block && block.type === "tool_result",
        )),
  )

  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
    ...(anthropicBeta && { "anthropic-beta": anthropicBeta }),
  }

  const url = `${copilotBaseUrl(state)}/v1/messages`
  consola.debug(`Calling Copilot native Messages API: ${url}`)

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    consola.error("Failed to create messages", response.status, errorBody)
    // Dump request payload to file for debugging if enabled
    if (state.dumpErrors) {
      const { Authorization, ...headersWithoutToken } = headers
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
      const dumpFile = `messages-error-${timestamp}.json`
      writeFileSync(
        dumpFile,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            url,
            requestHeaders: headersWithoutToken,
            originalHeaders: originalHeaders ?? "not provided",
            error: { status: response.status, body: errorBody },
            originalPayload: originalPayload ?? "not provided",
            sentPayload: payload,
          },
          null,
          2,
        ),
      )
      consola.error(`Request payload dumped to: ${dumpFile}`)
    }
    throw new HTTPError("Failed to create messages", response, errorBody)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as AnthropicResponse
}

export { type AnthropicResponse } from "~/routes/messages/anthropic-types"
