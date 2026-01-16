import consola from "consola"
import { events } from "fetch-event-stream"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Re-export for convenience

/**
 * Directly call Copilot backend /v1/messages endpoint
 * Used for models that support native Anthropic Messages API
 */
export const createMessages = async (payload: AnthropicMessagesPayload) => {
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
    throw new HTTPError("Failed to create messages", response, errorBody)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as AnthropicResponse
}

export { type AnthropicResponse } from "~/routes/messages/anthropic-types"
