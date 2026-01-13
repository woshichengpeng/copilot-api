// =====================================================
// Gemini API Request Types
// =====================================================

export interface GeminiGenerateContentRequest {
  contents: Array<GeminiContent>
  tools?: Array<GeminiTool>
  toolConfig?: GeminiToolConfig
  safetySettings?: Array<GeminiSafetySetting>
  systemInstruction?: GeminiContent
  generationConfig?: GeminiGenerationConfig
  cachedContent?: string
}

export interface GeminiContent {
  role: "user" | "model"
  parts: Array<GeminiPart>
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart
  | GeminiInlineDataPart

export interface GeminiTextPart {
  text: string
}

export interface GeminiFunctionCallPart {
  functionCall: {
    id?: string
    name: string
    args: Record<string, unknown>
  }
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    id?: string
    name: string
    response: Record<string, unknown>
  }
}

export interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string
    data: string // base64 encoded
  }
}

export interface GeminiTool {
  functionDeclarations?: Array<GeminiFunctionDeclaration>
}

export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown> // JSON Schema
  parametersJsonSchema?: Record<string, unknown> // Alternative JSON Schema field
}

export interface GeminiToolConfig {
  functionCallingConfig?: {
    mode?: "AUTO" | "ANY" | "NONE"
    allowedFunctionNames?: Array<string>
  }
}

export interface GeminiSafetySetting {
  category: string
  threshold: string
}

export interface GeminiGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  stopSequences?: Array<string>
  candidateCount?: number
  responseMimeType?: string
}

// =====================================================
// Gemini API Response Types
// =====================================================

export interface GeminiGenerateContentResponse {
  candidates?: Array<GeminiCandidate>
  promptFeedback?: GeminiPromptFeedback
  usageMetadata?: GeminiUsageMetadata
  modelVersion?: string
}

export interface GeminiCandidate {
  content?: {
    role: "model"
    parts: Array<GeminiPart>
  }
  finishReason?: GeminiFinishReason
  index: number
  safetyRatings?: Array<GeminiSafetyRating>
}

export type GeminiFinishReason =
  | "FINISH_REASON_UNSPECIFIED"
  | "STOP"
  | "MAX_TOKENS"
  | "SAFETY"
  | "RECITATION"
  | "LANGUAGE"
  | "OTHER"
  | "BLOCKLIST"
  | "PROHIBITED_CONTENT"
  | "SPII"
  | "MALFORMED_FUNCTION_CALL"

export interface GeminiPromptFeedback {
  blockReason?: string
  safetyRatings?: Array<GeminiSafetyRating>
}

export interface GeminiSafetyRating {
  category: string
  probability: string
  blocked?: boolean
}

export interface GeminiUsageMetadata {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
}

// =====================================================
// Stream State for Translation
// =====================================================

export interface GeminiStreamState {
  accumulatedFunctionCalls: Map<
    number,
    {
      id: string
      name: string
      args: string
    }
  >
  model: string
}

// =====================================================
// Type Guards
// =====================================================

export function isTextPart(part: GeminiPart): part is GeminiTextPart {
  return "text" in part
}

export function isFunctionCallPart(
  part: GeminiPart,
): part is GeminiFunctionCallPart {
  return "functionCall" in part
}

export function isFunctionResponsePart(
  part: GeminiPart,
): part is GeminiFunctionResponsePart {
  return "functionResponse" in part
}

export function isInlineDataPart(
  part: GeminiPart,
): part is GeminiInlineDataPart {
  return "inlineData" in part
}
