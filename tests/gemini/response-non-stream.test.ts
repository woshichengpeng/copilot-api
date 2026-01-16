import { describe, test, expect } from "bun:test"
import { z } from "zod"

import type {
  GeminiFinishReason,
  GeminiFunctionCallPart,
  GeminiTextPart,
} from "~/routes/gemini/gemini-types"
import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import { translateToGemini } from "../../src/routes/gemini/non-stream-translation"

// Minimal Zod schema for response validation
const geminiResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z
        .object({
          role: z.literal("model"),
          parts: z.array(z.any()),
        })
        .optional(),
      finishReason: z.string().optional(),
      index: z.number(),
    }),
  ),
  usageMetadata: z
    .object({
      promptTokenCount: z.number(),
      candidatesTokenCount: z.number(),
      totalTokenCount: z.number(),
    })
    .optional(),
})

describe("OpenAI to Gemini Non-Streaming Response Translation", () => {
  test("should translate simple text response", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello from OpenAI",
          },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }

    const result = translateToGemini(openAIResponse, "gemini-1.5-pro")

    expect(geminiResponseSchema.safeParse(result).success).toBe(true)
    expect(result.candidates).toBeDefined()
    if (result.candidates && result.candidates[0]) {
      const textPart = result.candidates[0].content?.parts[0] as GeminiTextPart
      expect(textPart.text).toBe("Hello from OpenAI")
      expect(result.candidates[0].finishReason).toBe("STOP")
    }
    expect(result.usageMetadata?.promptTokenCount).toBe(10)
    expect(result.usageMetadata?.candidatesTokenCount).toBe(5)
  })

  test("should translate tool calls", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: JSON.stringify({ location: "Paris" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
    }

    const result = translateToGemini(openAIResponse, "gemini-1.5-pro")

    expect(result.candidates).toBeDefined()
    if (
      result.candidates
      && result.candidates[0]
      && result.candidates[0].content
    ) {
      const functionCallPart = result.candidates[0].content
        .parts[0] as GeminiFunctionCallPart
      expect(functionCallPart.functionCall).toBeDefined()
      expect(functionCallPart.functionCall.name).toBe("get_weather")
      expect(functionCallPart.functionCall.args).toEqual({
        location: "Paris",
      })
      expect(result.candidates[0].finishReason).toBe("STOP") // Map tool_calls -> STOP (or generic handling)
    }
  })

  test("should handle mixed text and tool calls", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Checking weather...",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: "{}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
    }

    const result = translateToGemini(openAIResponse, "gemini-1.5-pro")

    expect(result.candidates).toBeDefined()
    if (
      result.candidates
      && result.candidates[0]
      && result.candidates[0].content
    ) {
      expect(result.candidates[0].content.parts).toHaveLength(2)
      const textPart = result.candidates[0].content.parts[0] as GeminiTextPart
      expect(textPart.text).toBe("Checking weather...")
      const functionCallPart = result.candidates[0].content
        .parts[1] as GeminiFunctionCallPart
      expect(functionCallPart.functionCall).toBeDefined()
    }
  })

  test("should translate finish reasons correctly", () => {
    const reasons: Array<
      [
        ChatCompletionResponse["choices"][0]["finish_reason"],
        GeminiFinishReason,
      ]
    > = [
      ["stop", "STOP"],
      ["length", "MAX_TOKENS"],
      ["content_filter", "SAFETY"],
      ["tool_calls", "STOP"],
    ]

    for (const [openAIReason, geminiReason] of reasons) {
      const response: ChatCompletionResponse = {
        id: "id",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi" },
            finish_reason: openAIReason,
            logprobs: null,
          },
        ],
      }
      const result = translateToGemini(response, "m")
      expect(result.candidates).toBeDefined()
      if (result.candidates && result.candidates[0]) {
        expect(result.candidates[0].finishReason).toBe(geminiReason)
      }
    }
  })
})
