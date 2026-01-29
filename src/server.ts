import { Hono } from "hono"
import { cors } from "hono/cors"

import { completionRoutes } from "./routes/chat-completions/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { geminiRoutes } from "./routes/gemini/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { responseRoutes } from "./routes/responses/route"
import { tokenRoute } from "./routes/token/route"
import { usageRoute } from "./routes/usage/route"

type Variables = {
  model?: string
  thinking?: string
}

export const server = new Hono<{ Variables: Variables }>()

server.use(cors())

server.use(async (c, next) => {
  const start = Date.now()
  try {
    await next()
  } finally {
    const durationMs = Date.now() - start
    const duration =
      durationMs >= 1000 ?
        `${(durationMs / 1000).toFixed(1)}s`
      : `${durationMs}ms`
    const model = c.get("model")
    const thinking = c.get("thinking")
    const extra = [
      model && `model=${model}`,
      thinking && `thinking=${thinking}`,
    ]
      .filter(Boolean)
      .join(" ")
    const timestamp = new Date().toLocaleTimeString()
    const line = [
      "-->",
      c.req.method,
      c.req.path,
      c.res.status,
      duration,
      extra,
      `[${timestamp}]`,
    ]
      .filter(Boolean)
      .join(" ")

    console.log(line)
  }
})

server.get("/", (c) => c.text("Server running"))

server.route("/chat/completions", completionRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token", tokenRoute)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)

// OpenAI Response API compatible endpoints
server.route("/responses", responseRoutes)
server.route("/v1/responses", responseRoutes)

// Gemini compatible endpoints
server.route("/v1beta", geminiRoutes)
