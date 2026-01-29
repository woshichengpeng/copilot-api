import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

/**
 * Close the current content block, handling signature_delta for thinking blocks
 */
function closeCurrentBlock(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
): void {
  if (!state.contentBlockOpen) return

  // If this is a thinking block with accumulated signature, emit signature_delta first
  if (
    state.contentBlockType === "thinking"
    && state.accumulatedReasoningOpaque
  ) {
    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "signature_delta",
        signature: state.accumulatedReasoningOpaque,
      },
    })
    state.accumulatedReasoningOpaque = undefined
  }

  events.push({
    type: "content_block_stop",
    index: state.contentBlockIndex,
  })
  state.contentBlockIndex++
  state.contentBlockOpen = false
  state.contentBlockType = null
}

// eslint-disable-next-line max-lines-per-function, complexity
export function translateChunkToAnthropicEvents(
  chunk: ChatCompletionChunk,
  state: AnthropicStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []

  if (chunk.choices.length === 0) {
    return events
  }

  const choice = chunk.choices[0]
  const { delta } = choice

  if (!state.messageStartSent) {
    events.push({
      type: "message_start",
      message: {
        id: chunk.id,
        type: "message",
        role: "assistant",
        content: [],
        model: chunk.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0)
            - (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: 0, // Will be updated in message_delta when finished
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens
            !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
    })
    state.messageStartSent = true
  }

  // 1. Handle reasoning (thinking) - must come first
  if (delta.reasoning_text || delta.reasoning_opaque) {
    // If current block is not thinking, close it and open a thinking block
    if (state.contentBlockType !== "thinking") {
      closeCurrentBlock(state, events)
      events.push({
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: {
          type: "thinking",
          thinking: "",
        },
      })
      state.contentBlockOpen = true
      state.contentBlockType = "thinking"
    }

    if (delta.reasoning_text) {
      events.push({
        type: "content_block_delta",
        index: state.contentBlockIndex,
        delta: {
          type: "thinking_delta",
          thinking: delta.reasoning_text,
        },
      })
    }

    // Accumulate reasoning_opaque - append if incremental, or replace if full value
    // (Copilot typically sends full value each time, but handle incremental for safety)
    if (delta.reasoning_opaque) {
      state.accumulatedReasoningOpaque =
        (state.accumulatedReasoningOpaque ?? "") + delta.reasoning_opaque
    }
  }

  // 2. Handle content (text) - comes after thinking
  if (delta.content) {
    // If current block is thinking, close it first
    if (state.contentBlockType === "thinking") {
      closeCurrentBlock(state, events)
    }

    // If current block is a tool, close it first
    if (state.contentBlockType === "tool") {
      closeCurrentBlock(state, events)
    }

    if (!state.contentBlockOpen) {
      events.push({
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: {
          type: "text",
          text: "",
        },
      })
      state.contentBlockOpen = true
      state.contentBlockType = "text"
    }

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "text_delta",
        text: delta.content,
      },
    })
  }

  // 3. Handle tool_calls - comes last
  if (delta.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        // New tool call starting - close any open block first
        if (state.contentBlockOpen) {
          closeCurrentBlock(state, events)
        }

        const anthropicBlockIndex = state.contentBlockIndex
        state.toolCalls[toolCall.index] = {
          id: toolCall.id,
          name: toolCall.function.name,
          anthropicBlockIndex,
        }

        events.push({
          type: "content_block_start",
          index: anthropicBlockIndex,
          content_block: {
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: {},
          },
        })
        state.contentBlockOpen = true
        state.contentBlockType = "tool"
      }

      if (toolCall.function?.arguments) {
        const toolCallInfo = state.toolCalls[toolCall.index]
        // Tool call can still be empty
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (toolCallInfo) {
          events.push({
            type: "content_block_delta",
            index: toolCallInfo.anthropicBlockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: toolCall.function.arguments,
            },
          })
        }
      }
    }
  }

  if (choice.finish_reason) {
    if (state.contentBlockOpen) {
      closeCurrentBlock(state, events)
    }

    events.push(
      {
        type: "message_delta",
        delta: {
          stop_reason: mapOpenAIStopReasonToAnthropic(choice.finish_reason),
          stop_sequence: null,
        },
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0)
            - (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: chunk.usage?.completion_tokens ?? 0,
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens
            !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
      {
        type: "message_stop",
      },
    )
  }

  return events
}

export function translateErrorToAnthropicErrorEvent(): AnthropicStreamEventData {
  return {
    type: "error",
    error: {
      type: "api_error",
      message: "An unexpected error occurred during streaming.",
    },
  }
}
