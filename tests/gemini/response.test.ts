import { describe, test, expect } from "bun:test"
import { z } from "zod"

// Schema based on Google Gemini API error format
// https://ai.google.dev/api/rest/v1beta/models/generateContent
const geminiErrorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    status: z.string(),
  }),
})

describe("Gemini Response Format", () => {
  test("should have a valid Gemini error response structure", () => {
    const errorResponse = {
      error: {
        code: 400,
        message: "Invalid argument",
        status: "INVALID_ARGUMENT",
      },
    }

    const result = geminiErrorSchema.safeParse(errorResponse)
    expect(result.success).toBe(true)
  })

  test("should validate internal error structure", () => {
    const errorResponse = {
      error: {
        code: 500,
        message: "Internal server error",
        status: "INTERNAL",
      },
    }

    const result = geminiErrorSchema.safeParse(errorResponse)
    expect(result.success).toBe(true)
  })
})
