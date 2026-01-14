import { describe, test, expect } from "bun:test"
import { z } from "zod"

// Minimal schema for verifying response structure
const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    param: z.unknown().optional(),
    code: z.union([z.string(), z.number()]).optional(),
  }),
})

describe("OpenAI Response Format", () => {
  test("should have a valid error response structure", () => {
    const errorResponse = {
      error: {
        message: "Invalid API key",
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key",
      },
    }

    const result = errorResponseSchema.safeParse(errorResponse)
    expect(result.success).toBe(true)
  })

  test("should validate standard error fields", () => {
    const errorResponse = {
      error: {
        message: "Rate limit reached",
        type: "rate_limit_error",
        code: 429,
      },
    }

    const result = errorResponseSchema.safeParse(errorResponse)
    expect(result.success).toBe(true)
  })
})
