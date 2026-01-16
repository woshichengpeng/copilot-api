import consola from "consola"
import { events } from "fetch-event-stream"

import type {
  ResponseAPIPayload,
  ResponseAPIResponse,
} from "~/routes/responses/response-api-types"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Re-export for convenience

/**
 * Directly call Copilot backend /responses endpoint
 * Used for models that only support Response API (like codex models)
 */
export const createResponses = async (payload: ResponseAPIPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision =
    typeof payload.input !== "string"
    && payload.input?.some(
      (item) =>
        "content" in item
        && Array.isArray(item.content)
        && item.content.some((c) => c.type === "input_image"),
    )

  // Agent/user check for X-Initiator header
  const isAgentCall =
    typeof payload.input !== "string"
    && payload.input?.some(
      (item) =>
        ("role" in item && ["assistant", "tool"].includes(item.role))
        || ("type" in item
          && item.type !== undefined
          && ["function_call", "function_call_output"].includes(item.type)),
    )

  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const url = `${copilotBaseUrl(state)}/responses`
  consola.debug(`Calling Copilot native Responses API: ${url}`)

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    consola.error("Failed to create responses", response.status, errorBody)
    throw new HTTPError("Failed to create responses", response, errorBody)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponseAPIResponse
}

export { type ResponseAPIResponse } from "~/routes/responses/response-api-types"
