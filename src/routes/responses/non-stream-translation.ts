import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import type {
  FunctionCallOutput,
  OutputItem,
  OutputMessage,
  ResponseAPIPayload,
  ResponseAPIResponse,
  ResponseUsage,
} from "./response-api-types"

import {
  generateItemId,
  generateResponseId,
  mapFinishReasonToStatus,
} from "./utils"

export function translateToResponseAPI(
  response: ChatCompletionResponse,
  payload: ResponseAPIPayload,
): ResponseAPIResponse {
  const { outputItems, outputText } = extractOutputItems(response)
  const finishReason = response.choices[0]?.finish_reason ?? null

  return {
    id: generateResponseId(response.id),
    object: "response",
    status: mapFinishReasonToStatus(finishReason),
    created_at: response.created,
    model: response.model,
    output: outputItems,
    output_text: outputText,
    error: null,
    incomplete_details:
      finishReason === "length" ? { reason: "max_output_tokens" } : null,
    usage: extractUsage(response),
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_output_tokens: payload.max_output_tokens,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
    truncation: payload.truncation,
    reasoning: payload.reasoning,
    metadata: payload.metadata,
  }
}

function extractOutputItems(response: ChatCompletionResponse): {
  outputItems: Array<OutputItem>
  outputText: string | null
} {
  const outputItems: Array<OutputItem> = []
  let outputText: string | null = null

  for (const choice of response.choices) {
    const { message } = choice

    if (message.content) {
      outputItems.push(createMessageItem(message.content))
      outputText = message.content
    }

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        outputItems.push(createToolCallItem(toolCall))
      }
    }
  }

  return { outputItems, outputText }
}

function createMessageItem(content: string): OutputMessage {
  return {
    id: generateItemId("msg"),
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: content, annotations: [] }],
  }
}

interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

function createToolCallItem(toolCall: ToolCall): FunctionCallOutput {
  return {
    id: generateItemId("fc"),
    type: "function_call",
    call_id: toolCall.id,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments,
    status: "completed",
  }
}

function extractUsage(response: ChatCompletionResponse): ResponseUsage {
  const usage = response.usage

  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    input_tokens_details:
      usage?.prompt_tokens_details?.cached_tokens ?
        { cached_tokens: usage.prompt_tokens_details.cached_tokens }
      : undefined,
    output_tokens: usage?.completion_tokens ?? 0,
    output_tokens_details: undefined,
    total_tokens: usage?.total_tokens ?? 0,
  }
}
