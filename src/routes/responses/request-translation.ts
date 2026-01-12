import type {
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"

import type {
  FunctionCallInput,
  FunctionCallOutputInput,
  InputContentPart,
  InputItem,
  InputMessage,
  ResponseAPIPayload,
  ResponseAPITool,
} from "./response-api-types"

export function translateToOpenAI(
  payload: ResponseAPIPayload,
): ChatCompletionsPayload {
  return {
    model: payload.model,
    messages: translateInputToMessages(payload.input, payload.instructions),
    max_tokens: payload.max_output_tokens,
    temperature: payload.temperature,
    top_p: payload.top_p,
    stream: payload.stream,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    user: payload.user,
  }
}

function translateInputToMessages(
  input: string | Array<InputItem> | undefined,
  instructions: string | undefined,
): Array<Message> {
  const messages: Array<Message> = []

  if (instructions) {
    messages.push({ role: "system", content: instructions })
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input })
    return messages
  }

  if (!input || !Array.isArray(input)) {
    return messages
  }

  // Group consecutive function_call items into a single assistant message
  let i = 0
  while (i < input.length) {
    const item = input[i]

    // Check if this is a function_call that needs grouping
    if ("type" in item && item.type === "function_call") {
      const toolCalls: Array<ToolCall> = []

      // Collect all consecutive function_call items
      while (i < input.length) {
        const current = input[i]
        if ("type" in current && current.type === "function_call") {
          const funcCall = current
          toolCalls.push({
            id: funcCall.call_id,
            type: "function",
            function: {
              name: funcCall.name,
              arguments: funcCall.arguments,
            },
          })
          i++
        } else {
          break
        }
      }

      // Create single assistant message with all tool calls
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      })
    } else {
      // Handle other item types normally
      const message = translateInputItem(item)
      if (message) {
        messages.push(message)
      }
      i++
    }
  }

  return messages
}

function translateInputItem(item: InputItem): Message | null {
  // Handle typed items (function_call, function_call_output, etc.)
  if ("type" in item && item.type && !("role" in item)) {
    return translateTypedItem(item)
  }

  // Handle message items (with role)
  if ("role" in item) {
    return translateMessageItem(item)
  }

  return null
}

function translateTypedItem(
  item: FunctionCallInput | FunctionCallOutputInput | { type: string },
): Message | null {
  if (item.type === "function_call") {
    const funcCall = item as FunctionCallInput
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: funcCall.call_id,
          type: "function",
          function: {
            name: funcCall.name,
            arguments: funcCall.arguments,
          },
        },
      ],
    }
  }

  if (item.type === "function_call_output") {
    const funcOutput = item as FunctionCallOutputInput
    return {
      role: "tool",
      tool_call_id: funcOutput.call_id,
      content: funcOutput.output,
    }
  }

  // GitHub Copilot doesn't support reasoning/item_reference, skip
  return null
}

function translateMessageItem(msg: InputMessage): Message {
  if (msg.role === "system" || msg.role === "developer") {
    return {
      role: "system",
      content: extractTextContent(msg.content),
    }
  }

  if (msg.role === "user") {
    return {
      role: "user",
      content: translateUserContent(msg.content),
    }
  }

  return {
    role: "assistant",
    content: extractTextContent(msg.content),
  }
}

function extractTextContent(content: string | Array<InputContentPart>): string {
  if (typeof content === "string") return content

  return content
    .filter((part) => part.type === "input_text")
    .map((part) => part.text)
    .join("\n\n")
}

function translateUserContent(
  content: string | Array<InputContentPart>,
): string | Array<ContentPart> {
  if (typeof content === "string") return content

  const hasImage = content.some((part) => part.type === "input_image")

  if (!hasImage) {
    return extractTextContent(content)
  }

  return content.map((part): ContentPart => {
    if (part.type === "input_text") {
      return { type: "text", text: part.text }
    }
    return {
      type: "image_url",
      image_url: {
        url: part.image_url ?? "",
        detail: part.detail,
      },
    }
  })
}

function translateTools(
  tools: Array<ResponseAPITool> | undefined,
): Array<Tool> | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
    },
  }))
}

function translateToolChoice(
  toolChoice: ResponseAPIPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!toolChoice) return undefined

  if (typeof toolChoice === "string") {
    return toolChoice
  }

  return { type: "function", function: { name: toolChoice.name } }
}
