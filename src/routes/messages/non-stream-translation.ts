import {
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type ContentPart,
  type Message,
  type TextPart,
  type Tool,
  type ToolCall,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicAssistantContentBlock,
  type AnthropicAssistantMessage,
  type AnthropicMessage,
  type AnthropicMessagesPayload,
  type AnthropicResponse,
  type AnthropicTextBlock,
  type AnthropicThinkingBlock,
  type AnthropicTool,
  type AnthropicToolResultBlock,
  type AnthropicToolUseBlock,
  type AnthropicUserContentBlock,
  type AnthropicUserMessage,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

// Payload translation

export function translateToOpenAI(
  payload: AnthropicMessagesPayload,
): ChatCompletionsPayload {
  // Clean up incomplete tool_use messages to prevent API errors
  const cleanedMessages = cleanupIncompleteToolUse(payload.messages)
  
  // Translate to OpenAI format
  const openAIMessages = translateAnthropicMessagesToOpenAI(
    cleanedMessages,
    payload.system,
  )
  
  // Final cleanup at OpenAI level to ensure tool_use/tool_result pairing
  const finalMessages = cleanupOpenAIToolSequence(openAIMessages)
  
  return {
    model: payload.model,
    messages: finalMessages,
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    user: payload.metadata?.user_id,
    tools: translateAnthropicToolsToOpenAI(payload.tools),
    tool_choice: translateAnthropicToolChoiceToOpenAI(payload.tool_choice),
  }
}

function translateAnthropicMessagesToOpenAI(
  anthropicMessages: Array<AnthropicMessage>,
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<Message> {
  const systemMessages = handleSystemPrompt(system)
  const otherMessages = anthropicMessages.flatMap((message) => {
    if (message.role === "user") {
      return handleUserMessage(message)
    } else {
      return handleAssistantMessage(message)
    }
  })

  return [...systemMessages, ...otherMessages]
}

function handleSystemPrompt(
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<Message> {
  if (!system) {
    return []
  }

  if (typeof system === "string") {
    return [{ role: "system", content: system }]
  } else {
    const systemText = system.map((block) => block.text).join("\n\n")
    return [{ role: "system", content: systemText }]
  }
}

function handleUserMessage(message: AnthropicUserMessage): Array<Message> {
  const newMessages: Array<Message> = []

  if (Array.isArray(message.content)) {
    const toolResultBlocks = message.content.filter(
      (block): block is AnthropicToolResultBlock =>
        block.type === "tool_result",
    )
    const otherBlocks = message.content.filter(
      (block) => block.type !== "tool_result",
    )

    if (otherBlocks.length > 0) {
      newMessages.push({
        role: "user",
        content: mapContent(otherBlocks),
      })
    }

    for (const block of toolResultBlocks) {
      newMessages.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: block.content,
      })
    }
  } else {
    newMessages.push({
      role: "user",
      content: mapContent(message.content),
    })
  }

  return newMessages
}

function handleAssistantMessage(
  message: AnthropicAssistantMessage,
): Array<Message> {
  if (!Array.isArray(message.content)) {
    return [
      {
        role: "assistant",
        content: mapContent(message.content),
      },
    ]
  }

  const toolUseBlocks = message.content.filter(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use",
  )

  const textBlocks = message.content.filter(
    (block): block is AnthropicTextBlock => block.type === "text",
  )

  const thinkingBlocks = message.content.filter(
    (block): block is AnthropicThinkingBlock => block.type === "thinking",
  )

  // Combine text and thinking blocks, as OpenAI doesn't have separate thinking blocks
  const allTextContent = [
    ...textBlocks.map((b) => b.text),
    ...thinkingBlocks.map((b) => b.thinking),
  ].join("\n\n")

  return toolUseBlocks.length > 0 ?
      [
        {
          role: "assistant",
          content: allTextContent || null,
          tool_calls: toolUseBlocks.map((toolUse) => ({
            id: toolUse.id,
            type: "function",
            function: {
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input),
            },
          })),
        },
      ]
    : [
        {
          role: "assistant",
          content: mapContent(message.content),
        },
      ]
}

function mapContent(
  content:
    | string
    | Array<AnthropicUserContentBlock | AnthropicAssistantContentBlock>,
): string | Array<ContentPart> | null {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return null
  }

  const hasImage = content.some((block) => block.type === "image")
  if (!hasImage) {
    return content
      .filter(
        (block): block is AnthropicTextBlock | AnthropicThinkingBlock =>
          block.type === "text" || block.type === "thinking",
      )
      .map((block) => (block.type === "text" ? block.text : block.thinking))
      .join("\n\n")
  }

  const contentParts: Array<ContentPart> = []
  for (const block of content) {
    switch (block.type) {
      case "text": {
        contentParts.push({ type: "text", text: block.text })

        break
      }
      case "thinking": {
        contentParts.push({ type: "text", text: block.thinking })

        break
      }
      case "image": {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        })

        break
      }
      // No default
    }
  }
  return contentParts
}

function translateAnthropicToolsToOpenAI(
  anthropicTools: Array<AnthropicTool> | undefined,
): Array<Tool> | undefined {
  if (!anthropicTools) {
    return undefined
  }
  return anthropicTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

function translateAnthropicToolChoiceToOpenAI(
  anthropicToolChoice: AnthropicMessagesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!anthropicToolChoice) {
    return undefined
  }

  switch (anthropicToolChoice.type) {
    case "auto": {
      return "auto"
    }
    case "any": {
      return "required"
    }
    case "tool": {
      if (anthropicToolChoice.name) {
        return {
          type: "function",
          function: { name: anthropicToolChoice.name },
        }
      }
      return undefined
    }
    case "none": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}

// Response translation

export function translateToAnthropic(
  response: ChatCompletionResponse,
): AnthropicResponse {
  const choice = response.choices[0]
  const textBlocks = getAnthropicTextBlocks(choice.message.content)
  const toolUseBlocks = getAnthropicToolUseBlocks(choice.message.tool_calls)
  // Note: GitHub Copilot doesn't generate thinking blocks, so we don't include them in responses

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content: [...textBlocks, ...toolUseBlocks],
    stop_reason: mapOpenAIStopReasonToAnthropic(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  }
}

function getAnthropicTextBlocks(
  messageContent: Message["content"],
): Array<AnthropicTextBlock> {
  if (typeof messageContent === "string") {
    return [{ type: "text", text: messageContent }]
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => ({ type: "text", text: part.text }))
  }

  return []
}

function getAnthropicToolUseBlocks(
  toolCalls: Array<ToolCall> | undefined,
): Array<AnthropicToolUseBlock> {
  if (!toolCalls) {
    return []
  }
  return toolCalls.map((toolCall) => ({
    type: "tool_use",
    id: toolCall.id,
    name: toolCall.function.name,
    input: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
  }))
}

/**
 * Cleans up incomplete tool_use messages that don't have corresponding tool_result blocks.
 * This prevents API errors when requests with tool calls are cancelled.
 */
function cleanupIncompleteToolUse(
  messages: Array<AnthropicMessage>,
): Array<AnthropicMessage> {
  if (messages.length === 0) return messages
  
  const cleanedMessages: Array<AnthropicMessage> = []
  
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    
    // Skip if this message was already processed as a "next message"
    if (i > 0 && cleanedMessages.length > 0) {
      const lastProcessedIndex = cleanedMessages.length - 1
      // Check if we already processed this message
      if (cleanedMessages[lastProcessedIndex] === message) {
        continue
      }
    }
    
    // If this is an assistant message with tool_use blocks
    if (
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(block => block.type === "tool_use")
    ) {
      const toolUseBlocks = message.content.filter(
        (block): block is AnthropicToolUseBlock => block.type === "tool_use"
      )
      
      // Find the next user message that might contain tool_result blocks
      let nextMessageIndex = i + 1
      let nextMessage: AnthropicMessage | undefined
      
      while (nextMessageIndex < messages.length) {
        const candidate = messages[nextMessageIndex]
        if (candidate.role === "user") {
          nextMessage = candidate
          break
        }
        nextMessageIndex++
      }
      
      if (
        !nextMessage ||
        !Array.isArray(nextMessage.content)
      ) {
        // No next user message - remove all tool_use blocks
        const nonToolBlocks = message.content.filter(
          block => block.type !== "tool_use"
        )
        
        if (nonToolBlocks.length > 0) {
          cleanedMessages.push({
            ...message,
            content: nonToolBlocks,
          })
        }
        continue
      }
      
      const toolResultBlocks = nextMessage.content.filter(
        (block): block is AnthropicToolResultBlock => block.type === "tool_result"
      )
      
      // Build sets for comparison
      const toolResultIds = new Set(toolResultBlocks.map(block => block.tool_use_id))
      
      // Check if ALL tool_use blocks have corresponding tool_result blocks
      const orphanedToolUseBlocks = toolUseBlocks.filter(block => 
        !toolResultIds.has(block.id)
      )
      
      if (orphanedToolUseBlocks.length > 0) {
        // Remove orphaned tool_use blocks
        const validToolUseBlocks = toolUseBlocks.filter(block =>
          toolResultIds.has(block.id)
        )
        const nonToolBlocks = message.content.filter(
          block => block.type !== "tool_use"
        )
        
        const cleanedAssistantContent = [...nonToolBlocks, ...validToolUseBlocks]
        
        // Add cleaned assistant message if it has content
        if (cleanedAssistantContent.length > 0) {
          cleanedMessages.push({
            ...message,
            content: cleanedAssistantContent,
          })
        }
        
        // Clean up orphaned tool_result blocks in the next message
        const validToolResultBlocks = toolResultBlocks.filter(block =>
          validToolUseBlocks.some(toolUse => toolUse.id === block.tool_use_id)
        )
        const nonToolResultBlocks = nextMessage.content.filter(
          block => block.type !== "tool_result"
        )
        
        const cleanedUserContent = [...nonToolResultBlocks, ...validToolResultBlocks]
        
        // Process all messages between current and next message
        for (let j = i + 1; j < nextMessageIndex; j++) {
          cleanedMessages.push(messages[j])
        }
        
        // Add cleaned next message if it has content
        if (cleanedUserContent.length > 0) {
          cleanedMessages.push({
            ...nextMessage,
            content: cleanedUserContent,
          })
        }
        
        // Skip to after the processed messages
        i = nextMessageIndex
        continue
      }
    }
    
    cleanedMessages.push(message)
  }
  
  return cleanedMessages
}

/**
 * Final cleanup at OpenAI level to ensure proper tool_use/tool_result pairing
 */
function cleanupOpenAIToolSequence(messages: Array<Message>): Array<Message> {
  if (messages.length === 0) return messages
  
  const cleanedMessages: Array<Message> = []
  const validToolCallIds = new Set<string>() // Track valid tool call IDs
  
  // First pass: identify all valid tool call IDs
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    
    if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      // Find corresponding tool messages
      const toolMessages: Array<Message> = []
      let j = i + 1
      
      while (j < messages.length && messages[j].role === "tool") {
        const toolMsg = messages[j]
        if (toolMsg.tool_call_id) {
          toolMessages.push(toolMsg)
        }
        j++
      }
      
      // Only keep tool calls that have corresponding results
      const resultIds = new Set(toolMessages.map(msg => msg.tool_call_id).filter(Boolean))
      const validToolCalls = message.tool_calls.filter(call => resultIds.has(call.id))
      
      // Add valid tool call IDs to our set
      validToolCalls.forEach(call => validToolCallIds.add(call.id))
    }
  }
  
  // Second pass: build cleaned message list
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    
    if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      // Filter to only valid tool calls
      const validToolCalls = message.tool_calls.filter(call => validToolCallIds.has(call.id))
      
      if (validToolCalls.length > 0) {
        cleanedMessages.push({
          ...message,
          tool_calls: validToolCalls
        })
      } else {
        // No valid tool calls, add message without tool_calls
        const { tool_calls, ...messageWithoutTools } = message
        cleanedMessages.push(messageWithoutTools)
      }
    } else if (message.role === "tool") {
      // Only include tool messages that have valid tool_call_ids
      if (message.tool_call_id && validToolCallIds.has(message.tool_call_id)) {
        cleanedMessages.push(message)
      }
    } else {
      cleanedMessages.push(message)
    }
  }
  
  return cleanedMessages
}
