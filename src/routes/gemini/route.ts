import type { Context } from "hono"

import { Hono } from "hono"

import { HTTPError } from "~/lib/error"

import { handleGenerateContent, handleStreamGenerateContent } from "./handler"

export const geminiRoutes = new Hono()

/**
 * Format error response in Gemini API format
 */
function forwardGeminiError(c: Context, error: unknown) {
  if (error instanceof HTTPError) {
    const errorText = error.responseBody ?? error.message
    return c.json(
      {
        error: {
          code: error.response.status,
          message: errorText,
          status:
            error.response.status >= 500 ? "INTERNAL" : "INVALID_ARGUMENT",
        },
      },
      error.response.status as 400 | 404 | 500,
    )
  }

  return c.json(
    {
      error: {
        code: 500,
        message:
          error instanceof Error ? error.message : "Internal server error",
        status: "INTERNAL",
      },
    },
    500,
  )
}

// Non-streaming: POST /v1beta/models/{model}:generateContent
geminiRoutes.post(
  String.raw`/models/:modelWithMethod{.+\:generateContent}`,
  async (c) => {
    try {
      return await handleGenerateContent(c)
    } catch (error) {
      return forwardGeminiError(c, error)
    }
  },
)

// Streaming: POST /v1beta/models/{model}:streamGenerateContent
geminiRoutes.post(
  String.raw`/models/:modelWithMethod{.+\:streamGenerateContent}`,
  async (c) => {
    try {
      return await handleStreamGenerateContent(c)
    } catch (error) {
      return forwardGeminiError(c, error)
    }
  },
)
