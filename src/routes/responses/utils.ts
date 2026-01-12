import { randomBytes } from "node:crypto"

export function generateResponseId(originalId?: string): string {
  if (originalId) {
    return originalId.startsWith("resp_") ? originalId : `resp_${originalId}`
  }
  return `resp_${randomBytes(12).toString("hex")}`
}

export function generateItemId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`
}

export function mapFinishReasonToStatus(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): "completed" | "failed" | "in_progress" | "incomplete" {
  if (!finishReason) return "in_progress"

  switch (finishReason) {
    case "stop":
    case "tool_calls": {
      return "completed"
    }
    case "length": {
      return "incomplete"
    }
    case "content_filter": {
      return "incomplete"
    }
    default: {
      return "completed"
    }
  }
}
