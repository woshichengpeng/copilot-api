import { describe, test, expect } from "bun:test"

import type { ResponseAPIPayload } from "~/routes/responses/response-api-types"
import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  createStreamState,
  translateChunkToEvents,
} from "~/routes/responses/stream-translation"

describe("Response Stream Translation", () => {
  test("should reset accumulatedText after closing text message (P0 Bug)", () => {
    const payload: ResponseAPIPayload = {
      model: "gpt-4",
      input: "test",
    }
    const initialChunk: ChatCompletionChunk = {
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1234567890,
      model: "gpt-4",
      choices: [],
    }

    const state = createStreamState(payload, initialChunk)

    // 1. Assistant says "Hello"
    const chunk1: ChatCompletionChunk = {
      ...initialChunk,
      choices: [
        {
          index: 0,
          delta: { content: "Hello" },
          finish_reason: null,
          logprobs: null,
        },
      ],
    }
    translateChunkToEvents(chunk1, state)
    expect(state.accumulatedText).toBe("Hello")

    // 2. Tool execution (triggers closeTextMessage)
    const chunk2: ChatCompletionChunk = {
      ...initialChunk,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "test_tool", arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
          logprobs: null,
        },
      ],
    }
    translateChunkToEvents(chunk2, state)

    expect(state.accumulatedText).toBe("")
  })

  test("should correctly handle empty messages in handleFinish (P1 Lifecycle Bug)", () => {
    const payload: ResponseAPIPayload = {
      model: "gpt-4",
      input: "test",
    }
    const initialChunk: ChatCompletionChunk = {
      id: "test-id",
      object: "chat.completion.chunk",
      created: 1234567890,
      model: "gpt-4",
      choices: [],
    }

    const state = createStreamState(payload, initialChunk)

    // Start a message but with empty content (simulating initialization or empty delta that starts it)
    // Manually force start for testing specific internal state if needed,
    // but better to simulate via chunks.

    // Sending a chunk that starts message
    /*
    const chunk1: ChatCompletionChunk = {
        ...initialChunk,
        choices: [
          {
            index: 0,
            delta: { content: "" }, // Empty content
            finish_reason: null,
            logprobs: null,
          },
        ],
      }
    */

    // Depending on implementation, empty content might not trigger startTextMessage if check is strict?
    // Looking at code: if (delta.content) ... so empty string might check false in JS?
    // Wait, empty string is falsy.
    // If delta.content is "", `if (delta.content)` is false.
    // So handleTextDelta isn't called.

    // However, the P1 bug report says:
    // "if (state.messageStarted && state.accumulatedText)"
    // "Empty messages won't be closed"

    // If messageStarted is true, but accumulatedText is empty.
    // This happens if we had `startTextMessage` called but no text accumulated?
    // Or maybe accumulatedText was cleared?

    state.messageStarted = true
    state.accumulatedText = ""

    const finishChunk: ChatCompletionChunk = {
      ...initialChunk,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
          logprobs: null,
        },
      ],
    }

    const events = translateChunkToEvents(finishChunk, state)

    // We expect closeTextMessage to be called, which generates "response.output_item.done"
    const hasCloseEvent = events.some(
      (e) =>
        e.type === "response.output_item.done" && e.item.type === "message",
    )

    expect(hasCloseEvent).toBe(true)
  })
})
