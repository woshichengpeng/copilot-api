import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import type {
  FunctionCallOutput,
  OutputMessage,
  ResponseAPIPayload,
  ResponseAPIResponse,
  ResponseAPIStreamState,
  ResponseStreamEvent,
  ResponseUsage,
} from "./response-api-types"

import {
  generateItemId,
  generateResponseId,
  mapFinishReasonToStatus,
} from "./utils"

export function createStreamState(
  payload: ResponseAPIPayload,
  initialChunk: ChatCompletionChunk,
): ResponseAPIStreamState {
  return {
    responseId: generateResponseId(initialChunk.id),
    model: initialChunk.model,
    createdAt: initialChunk.created,
    messageStarted: false,
    currentOutputIndex: 0,
    currentContentIndex: 0,
    messageItemId: null,
    accumulatedText: "",
    totalAccumulatedText: "",
    accumulatedToolCalls: new Map(),
    outputItems: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
    payload,
  }
}

export function buildInitialResponse(
  state: ResponseAPIStreamState,
): ResponseAPIResponse {
  return buildResponseObject(state, "in_progress", null)
}

export function translateChunkToEvents(
  chunk: ChatCompletionChunk,
  state: ResponseAPIStreamState,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  if (chunk.choices.length === 0) {
    updateUsageFromChunk(state, chunk)
    return events
  }

  const choice = chunk.choices[0]
  const { delta } = choice

  if (delta.content) {
    events.push(...handleTextDelta(state, delta.content))
  }

  if (delta.tool_calls) {
    events.push(...handleToolCalls(state, delta.tool_calls))
  }

  if (choice.finish_reason) {
    events.push(...handleFinish(state, chunk, choice.finish_reason))
  }

  return events
}

function handleTextDelta(
  state: ResponseAPIStreamState,
  content: string,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  if (!state.messageStarted) {
    events.push(...startTextMessage(state))
  }

  const itemId = state.messageItemId ?? ""
  events.push({
    type: "response.output_text.delta",
    item_id: itemId,
    output_index: state.currentOutputIndex,
    content_index: state.currentContentIndex,
    delta: content,
  })

  state.accumulatedText += content
  state.totalAccumulatedText += content
  return events
}

function startTextMessage(
  state: ResponseAPIStreamState,
): Array<ResponseStreamEvent> {
  state.messageItemId = generateItemId("msg")

  const messageItem: OutputMessage = {
    id: state.messageItemId,
    type: "message",
    role: "assistant",
    status: "in_progress",
    content: [{ type: "output_text", text: "", annotations: [] }],
  }

  state.messageStarted = true

  return [
    {
      type: "response.output_item.added",
      output_index: state.currentOutputIndex,
      item: messageItem,
    },
    {
      type: "response.content_part.added",
      item_id: state.messageItemId,
      output_index: state.currentOutputIndex,
      content_index: state.currentContentIndex,
      part: { type: "output_text", text: "", annotations: [] },
    },
  ]
}

interface ToolCallDelta {
  index: number
  id?: string
  type?: "function"
  function?: {
    name?: string
    arguments?: string
  }
}

function handleToolCalls(
  state: ResponseAPIStreamState,
  toolCalls: Array<ToolCallDelta>,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  for (const toolCall of toolCalls) {
    if (toolCall.id && toolCall.function?.name) {
      events.push(...startToolCall(state, toolCall))
    }

    if (toolCall.function?.arguments) {
      events.push(...appendToolArguments(state, toolCall))
    }
  }

  return events
}

function startToolCall(
  state: ResponseAPIStreamState,
  toolCall: ToolCallDelta,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  if (state.messageStarted) {
    events.push(...closeTextMessage(state))
  }

  const toolOutputIndex = state.currentOutputIndex
  const toolItem: FunctionCallOutput = {
    id: generateItemId("fc"),
    type: "function_call",
    call_id: toolCall.id ?? "",
    name: toolCall.function?.name ?? "",
    arguments: "",
    status: "in_progress",
  }

  events.push({
    type: "response.output_item.added",
    output_index: toolOutputIndex,
    item: toolItem,
  })

  state.accumulatedToolCalls.set(toolCall.index, {
    id: toolItem.id,
    callId: toolCall.id ?? "",
    name: toolItem.name,
    args: "",
    outputIndex: toolOutputIndex,
  })

  state.currentOutputIndex++
  return events
}

function appendToolArguments(
  state: ResponseAPIStreamState,
  toolCall: ToolCallDelta,
): Array<ResponseStreamEvent> {
  const toolInfo = state.accumulatedToolCalls.get(toolCall.index)
  if (!toolInfo || !toolCall.function?.arguments) {
    return []
  }

  toolInfo.args += toolCall.function.arguments

  return [
    {
      type: "response.function_call_arguments.delta",
      item_id: toolInfo.id,
      output_index: toolInfo.outputIndex,
      delta: toolCall.function.arguments,
    },
  ]
}

function handleFinish(
  state: ResponseAPIStreamState,
  chunk: ChatCompletionChunk,
  finishReason: string,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  if (state.messageStarted) {
    events.push(...closeTextMessage(state))
  }

  events.push(...completeToolCalls(state))

  updateUsageFromChunk(state, chunk)

  const finalResponse = buildFinalResponse(state, finishReason)
  const eventType =
    finishReason === "length" ? "response.incomplete" : "response.completed"

  events.push({
    type: eventType,
    response: finalResponse,
  } as ResponseStreamEvent)

  return events
}

function completeToolCalls(
  state: ResponseAPIStreamState,
): Array<ResponseStreamEvent> {
  const events: Array<ResponseStreamEvent> = []

  for (const [, toolInfo] of state.accumulatedToolCalls) {
    events.push({
      type: "response.function_call_arguments.done",
      item_id: toolInfo.id,
      output_index: toolInfo.outputIndex,
      arguments: toolInfo.args,
    })

    const completedToolCall: FunctionCallOutput = {
      id: toolInfo.id,
      type: "function_call",
      call_id: toolInfo.callId,
      name: toolInfo.name,
      arguments: toolInfo.args,
      status: "completed",
    }

    events.push({
      type: "response.output_item.done",
      output_index: toolInfo.outputIndex,
      item: completedToolCall,
    })

    state.outputItems.push(completedToolCall)
  }

  return events
}

function closeTextMessage(
  state: ResponseAPIStreamState,
): Array<ResponseStreamEvent> {
  const itemId = state.messageItemId ?? ""

  const completedMessage: OutputMessage = {
    id: itemId,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [
      { type: "output_text", text: state.accumulatedText, annotations: [] },
    ],
  }

  const events: Array<ResponseStreamEvent> = [
    {
      type: "response.output_text.done",
      item_id: itemId,
      output_index: state.currentOutputIndex,
      content_index: state.currentContentIndex,
      text: state.accumulatedText,
    },
    {
      type: "response.content_part.done",
      item_id: itemId,
      output_index: state.currentOutputIndex,
      content_index: state.currentContentIndex,
      part: {
        type: "output_text",
        text: state.accumulatedText,
        annotations: [],
      },
    },
    {
      type: "response.output_item.done",
      output_index: state.currentOutputIndex,
      item: completedMessage,
    },
  ]

  state.outputItems.push(completedMessage)
  state.currentOutputIndex++
  state.messageStarted = false
  state.accumulatedText = ""

  return events
}

function updateUsageFromChunk(
  state: ResponseAPIStreamState,
  chunk: ChatCompletionChunk,
): void {
  if (!chunk.usage) return

  state.usage = parseUsage(chunk.usage)
}

function parseUsage(
  usage: NonNullable<ChatCompletionChunk["usage"]>,
): ResponseUsage {
  return {
    input_tokens: usage.prompt_tokens,
    input_tokens_details:
      usage.prompt_tokens_details?.cached_tokens ?
        { cached_tokens: usage.prompt_tokens_details.cached_tokens }
      : undefined,
    output_tokens: usage.completion_tokens,
    output_tokens_details: undefined,
    total_tokens: usage.total_tokens,
  }
}

function buildFinalResponse(
  state: ResponseAPIStreamState,
  finishReason: string,
): ResponseAPIResponse {
  const status = mapFinishReasonToStatus(
    finishReason as "stop" | "length" | "tool_calls" | "content_filter",
  )
  const incompleteDetails =
    finishReason === "length" ? { reason: "max_output_tokens" as const } : null

  return buildResponseObject(state, status, incompleteDetails)
}

function buildResponseObject(
  state: ResponseAPIStreamState,
  status: "completed" | "failed" | "in_progress" | "incomplete",
  incompleteDetails: { reason: "max_output_tokens" | "content_filter" } | null,
): ResponseAPIResponse {
  return {
    id: state.responseId,
    object: "response",
    status,
    created_at: state.createdAt,
    model: state.model,
    output: state.outputItems,
    output_text: state.totalAccumulatedText || null,
    error: null,
    incomplete_details: incompleteDetails,
    usage: state.usage,
    temperature: state.payload.temperature,
    top_p: state.payload.top_p,
    max_output_tokens: state.payload.max_output_tokens,
    tools: state.payload.tools,
    tool_choice: state.payload.tool_choice,
    truncation: state.payload.truncation,
    reasoning: state.payload.reasoning,
    metadata: state.payload.metadata,
  }
}
