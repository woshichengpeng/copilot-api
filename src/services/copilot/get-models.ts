import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const getModels = async () => {
  const response = await fetch(`${copilotBaseUrl(state)}/models`, {
    headers: copilotHeaders(state),
  })

  if (!response.ok) throw new HTTPError("Failed to get models", response)

  return (await response.json()) as ModelsResponse
}

export interface ModelsResponse {
  data: Array<Model>
  object: string
}

interface ModelLimits {
  max_context_window_tokens?: number
  max_output_tokens?: number
  max_prompt_tokens?: number
  max_inputs?: number
}

interface ModelSupports {
  tool_calls?: boolean
  parallel_tool_calls?: boolean
  dimensions?: boolean
}

interface ModelCapabilities {
  family: string
  limits: ModelLimits
  object: string
  supports: ModelSupports
  tokenizer: string
  type: string
}

export type ModelSupportedEndpoint =
  | "/chat/completions"
  | "/responses"
  | "/v1/messages"

export interface Model {
  capabilities: ModelCapabilities
  id: string
  model_picker_enabled: boolean
  name: string
  object: string
  preview: boolean
  vendor: string
  version: string
  policy?: {
    state: string
    terms: string
  }
  supported_endpoints?: Array<ModelSupportedEndpoint>
}

/**
 * Check if a model should use native Response API
 * Logic matches vscode-copilot-chat chatEndpoint.ts:222-231
 *
 * Returns true if:
 * - supported_endpoints exists AND doesn't include /chat/completions AND includes /responses
 * - OR supported_endpoints includes /responses (fallback)
 */
export function useResponsesApi(model: Model): boolean {
  if (!model.supported_endpoints) {
    return false
  }

  const supportsResponses = model.supported_endpoints.includes("/responses")
  const supportsChatCompletions =
    model.supported_endpoints.includes("/chat/completions")

  // Primary condition: supports /responses but NOT /chat/completions
  if (!supportsChatCompletions && supportsResponses) {
    return true
  }

  // VSCode also has: return !!supported_endpoints?.includes('/responses')
  // But that would make all models with /responses use it, even if they support /chat/completions
  // We'll stick with the stricter condition for now
  return false
}

/**
 * Check if a model should use native Messages API
 * Logic matches vscode-copilot-chat chatEndpoint.ts:233-236
 *
 * Returns true if supported_endpoints includes /v1/messages
 */
export function useMessagesApi(model: Model): boolean {
  if (!model.supported_endpoints) {
    return false
  }
  return model.supported_endpoints.includes("/v1/messages")
}

/**
 * @deprecated Use useResponsesApi instead
 */
export function modelRequiresResponsesApi(model: Model): boolean {
  return useResponsesApi(model)
}

/**
 * @deprecated Use useMessagesApi instead
 */
export function modelRequiresMessagesApi(model: Model): boolean {
  return useMessagesApi(model)
}

/**
 * Get model info from cached models by model ID
 */
export function getModelById(modelId: string): Model | undefined {
  return state.models?.data.find((m) => m.id === modelId)
}
