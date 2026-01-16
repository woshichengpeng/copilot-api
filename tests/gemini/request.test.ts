import { describe, test, expect } from "bun:test"
import { z } from "zod"

import type { GeminiGenerateContentRequest } from "~/routes/gemini/gemini-types"

import { translateToOpenAI } from "../../src/routes/gemini/request-translation"

// Minimal Zod schema for validation
const openAIRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(z.any()), z.null()]),
      tool_calls: z.array(z.any()).optional(),
      tool_call_id: z.string().optional(),
    }),
  ),
  tools: z.array(z.any()).optional(),
  tool_choice: z.union([z.string(), z.object({})]).optional(),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  stream: z.boolean(),
})

describe("Gemini to OpenAI Request Translation", () => {
  test("should translate basic user text message", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [
        {
          role: "user",
          parts: [{ text: "Hello world" }],
        },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(openAIRequestSchema.safeParse(result).success).toBe(true)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content).toBe("Hello world")
  })

  test("should translate system instructions", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      systemInstruction: {
        role: "user",
        parts: [{ text: "You are a helpful assistant" }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "Hi" }],
        },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.messages[0].role).toBe("system")
    expect(result.messages[0].content).toBe("You are a helpful assistant")
  })

  test("should translate generation config parameters", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      generationConfig: {
        temperature: 0.8,
        topP: 0.9,
        maxOutputTokens: 100,
        stopSequences: ["END"],
      },
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.temperature).toBe(0.8)
    expect(result.top_p).toBe(0.9)
    expect(result.max_tokens).toBe(100)
    expect(result.stop).toEqual(["END"])
  })

  test("should translate function tools", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [{ role: "user", parts: [{ text: "Check weather" }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: "get_weather",
              description: "Get weather info",
              parameters: {
                type: "OBJECT",
                properties: {
                  location: { type: "STRING" },
                },
              },
            },
          ],
        },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.tools).toBeDefined()
    expect(result.tools).toHaveLength(1)
    if (result.tools && result.tools[0]) {
      expect(result.tools[0].function.name).toBe("get_weather")
      // Should normalize types to lowercase
      const params = result.tools[0].function.parameters
      const properties = params.properties as Record<string, unknown>
      const location = properties.location as Record<string, unknown>
      expect(location.type).toBe("string")
    }
  })

  test("should translate assistant tool calls", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [
        {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { location: "London" },
              },
            },
          ],
        },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.messages[0].role).toBe("assistant")
    expect(result.messages[0].tool_calls).toHaveLength(1)
    if (result.messages[0].tool_calls && result.messages[0].tool_calls[0]) {
      expect(result.messages[0].tool_calls[0].function.name).toBe("get_weather")
      expect(result.messages[0].tool_calls[0].function.arguments).toBe(
        JSON.stringify({ location: "London" }),
      )
    }
  })

  test("should translate tool response", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [
        {
          role: "user", // Gemini uses "user" for tool responses in contents array
          parts: [
            {
              functionResponse: {
                name: "get_weather",
                response: { temp: 20 },
              },
            },
          ],
        },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.messages[0].role).toBe("tool")
    expect(result.messages[0].content).toBe(JSON.stringify({ temp: 20 }))
  })

  test("should merge consecutive user messages", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [
        { role: "user", parts: [{ text: "Part 1" }] },
        { role: "user", parts: [{ text: "Part 2" }] },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toBe("Part 1\n\nPart 2")
  })

  test("should handle multimodal content (text + image)", () => {
    const geminiRequest: GeminiGenerateContentRequest = {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Describe this image" },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: "base64data",
              },
            },
          ],
        },
      ],
    }

    const result = translateToOpenAI(geminiRequest, "gpt-4o", false)

    expect(result.messages[0].content).toBeArray()
    const content = result.messages[0].content as Array<{
      type: string
      image_url?: { url: string }
    }>
    expect(content).toHaveLength(2)
    expect(content[0].type).toBe("text")
    expect(content[1].type).toBe("image_url")
    expect(content[1].image_url?.url).toBe("data:image/jpeg;base64,base64data")
  })
})
