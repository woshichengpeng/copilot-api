import type {
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"

import type {
  GeminiContent,
  GeminiGenerateContentRequest,
  GeminiPart,
  GeminiTextPart,
  GeminiTool,
  GeminiToolConfig,
} from "./gemini-types"

import {
  isFunctionCallPart,
  isFunctionResponsePart,
  isInlineDataPart,
  isTextPart,
} from "./gemini-types"
import { generateToolCallId } from "./utils"

export function translateToOpenAI(
  request: GeminiGenerateContentRequest,
  model: string,
  stream: boolean,
): ChatCompletionsPayload {
  return {
    model,
    messages: translateContentsToMessages(
      request.contents,
      request.systemInstruction,
    ),
    max_tokens: request.generationConfig?.maxOutputTokens,
    temperature: request.generationConfig?.temperature,
    top_p: request.generationConfig?.topP,
    stop: request.generationConfig?.stopSequences,
    stream,
    tools: translateGeminiToolsToOpenAI(request.tools),
    tool_choice: translateToolConfig(request.toolConfig),
  }
}

function translateContentsToMessages(
  contents: Array<GeminiContent>,
  systemInstruction?: GeminiContent,
): Array<Message> {
  const messages: Array<Message> = []

  // Handle system instruction
  if (systemInstruction) {
    const systemText = extractTextFromParts(systemInstruction.parts)
    if (systemText) {
      messages.push({ role: "system", content: systemText })
    }
  }

  // Process each content entry
  for (const content of contents) {
    messages.push(...translateContentToMessages(content))
  }

  // Merge consecutive messages with the same role (OpenAI API requirement)
  return mergeConsecutiveMessages(messages)
}

/**
 * Merge consecutive messages with the same role.
 * OpenAI API doesn't allow multiple consecutive user or assistant messages.
 * This function merges them by concatenating their content.
 */
function mergeConsecutiveMessages(messages: Array<Message>): Array<Message> {
  if (messages.length === 0) {
    return messages
  }

  const merged: Array<Message> = []

  for (const message of messages) {
    const lastMessage = merged.at(-1)

    // Check if we can merge with the previous message
    if (canMergeMessages(lastMessage, message)) {
      // Merge the content
      lastMessage.content = mergeMessageContent(
        lastMessage.content,
        message.content,
      )
    } else {
      // Can't merge - add as new message
      merged.push({ ...message })
    }
  }

  return merged
}

function canMergeMessages(
  lastMessage: Message | undefined,
  message: Message,
): lastMessage is Message {
  return Boolean(
    lastMessage
      && lastMessage.role === message.role
      && lastMessage.role !== "tool"
      && !lastMessage.tool_calls
      && !message.tool_calls,
  )
}

function mergeMessageContent(
  lastContent: Message["content"],
  currentContent: Message["content"],
): Message["content"] {
  if (typeof lastContent === "string" && typeof currentContent === "string") {
    return `${lastContent}\n\n${currentContent}`
  }

  if (Array.isArray(lastContent) && Array.isArray(currentContent)) {
    return [...lastContent, ...currentContent]
  }

  if (typeof lastContent === "string" && Array.isArray(currentContent)) {
    return [{ type: "text" as const, text: lastContent }, ...currentContent]
  }

  if (Array.isArray(lastContent) && typeof currentContent === "string") {
    return [...lastContent, { type: "text" as const, text: currentContent }]
  }

  // Fallback: use current if it exists
  return currentContent ?? lastContent
}

function translateContentToMessages(content: GeminiContent): Array<Message> {
  const messages: Array<Message> = []
  const role = content.role === "model" ? "assistant" : "user"

  // Separate parts by type
  const textParts = content.parts.filter((part) => isTextPart(part))
  const functionCallParts = content.parts.filter((part) =>
    isFunctionCallPart(part),
  )
  const functionResponseParts = content.parts.filter((part) =>
    isFunctionResponsePart(part),
  )
  const inlineDataParts = content.parts.filter((part) => isInlineDataPart(part))

  // Handle function responses first (become tool messages)
  for (const part of functionResponseParts) {
    messages.push({
      role: "tool",
      tool_call_id:
        part.functionResponse.id
        ?? generateToolCallId(part.functionResponse.name),
      content: JSON.stringify(part.functionResponse.response),
    })
  }

  // Handle regular content with possible function calls
  if (
    textParts.length > 0
    || functionCallParts.length > 0
    || inlineDataParts.length > 0
  ) {
    const hasImages = inlineDataParts.length > 0

    if (role === "assistant" && functionCallParts.length > 0) {
      // Assistant message with tool calls
      const textContent = extractTextFromParts(textParts)
      const toolCalls: Array<ToolCall> = functionCallParts.map((part) => ({
        id: part.functionCall.id ?? generateToolCallId(part.functionCall.name),
        type: "function" as const,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      }))

      messages.push({
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls,
      })
    } else if (hasImages) {
      // User message with images
      const contentParts: Array<ContentPart> = [
        ...textParts.map((p) => ({ type: "text" as const, text: p.text })),
        ...inlineDataParts.map((p) => ({
          type: "image_url" as const,
          image_url: {
            url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
          },
        })),
      ]

      messages.push({
        role,
        content: contentParts,
      })
    } else {
      const textContent = extractTextFromParts(textParts)
      if (textContent) {
        messages.push({
          role,
          content: textContent,
        })
      }
    }
  }

  return messages
}

function extractTextFromParts(
  parts: Array<GeminiTextPart> | Array<GeminiPart>,
): string {
  const textParts = parts.filter((part) =>
    isTextPart(part),
  ) as Array<GeminiTextPart>
  return textParts.map((p) => p.text).join("")
}

function translateGeminiToolsToOpenAI(
  tools?: Array<GeminiTool>,
): Array<Tool> | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  const openAITools: Array<Tool> = []

  for (const tool of tools) {
    if (tool.functionDeclarations) {
      for (const funcDecl of tool.functionDeclarations) {
        openAITools.push({
          type: "function",
          function: {
            name: funcDecl.name,
            description: funcDecl.description,
            parameters:
              funcDecl.parameters ?? funcDecl.parametersJsonSchema ?? {},
          },
        })
      }
    }
  }

  return openAITools.length > 0 ? openAITools : undefined
}

function translateToolConfig(
  config?: GeminiToolConfig,
): ChatCompletionsPayload["tool_choice"] {
  if (!config?.functionCallingConfig?.mode) {
    return undefined
  }

  switch (config.functionCallingConfig.mode) {
    case "AUTO": {
      return "auto"
    }
    case "ANY": {
      return "required"
    }
    case "NONE": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}
