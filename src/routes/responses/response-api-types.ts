// =====================================================
// OpenAI Response API Type Definitions
// Based on https://platform.openai.com/docs/api-reference/responses
// =====================================================

// =====================================================
// Request Types
// =====================================================

export interface ResponseAPIPayload {
  model: string
  input?: string | Array<InputItem>
  instructions?: string
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  tools?: Array<ResponseAPITool>
  tool_choice?:
    | "auto"
    | "required"
    | "none"
    | { type: "function"; name: string }
  stream?: boolean
  reasoning?: {
    effort?: "low" | "medium" | "high"
    summary?: "auto" | "concise" | "detailed"
  }
  metadata?: Record<string, string>
  truncation?: "auto" | "disabled"
  user?: string
  store?: boolean
  parallel_tool_calls?: boolean
  previous_response_id?: string
}

// Input item types (discriminated union)
export type InputItem =
  | InputMessage
  | FunctionCallInput
  | FunctionCallOutputInput
  | ReasoningInput
  | ItemReference

export interface InputMessage {
  type?: "message"
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<InputContentPart>
}

export interface InputTextContent {
  type: "input_text"
  text: string
}

export interface InputImageContent {
  type: "input_image"
  image_url?: string
  file_id?: string
  detail?: "auto" | "low" | "high"
}

export type InputContentPart = InputTextContent | InputImageContent

export interface FunctionCallInput {
  type: "function_call"
  id?: string
  call_id: string
  name: string
  arguments: string
}

export interface FunctionCallOutputInput {
  type: "function_call_output"
  call_id: string
  output: string
}

export interface ReasoningInput {
  type: "reasoning"
  id: string
  summary: Array<{ type: "summary_text"; text: string }>
}

export interface ItemReference {
  type: "item_reference"
  id: string
}

export interface ResponseAPITool {
  type: "function"
  name: string
  description?: string
  parameters?: Record<string, unknown>
  strict?: boolean
}

// =====================================================
// Response Types
// =====================================================

export interface ResponseAPIResponse {
  id: string
  object: "response"
  status: "completed" | "failed" | "in_progress" | "incomplete"
  created_at: number
  model: string
  output: Array<OutputItem>
  output_text: string | null
  error: ResponseError | null
  incomplete_details: { reason?: "max_output_tokens" | "content_filter" } | null
  usage: ResponseUsage
  metadata?: Record<string, string>
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  tools?: Array<ResponseAPITool>
  tool_choice?:
    | "auto"
    | "required"
    | "none"
    | { type: "function"; name: string }
  truncation?: "auto" | "disabled"
  reasoning?: {
    effort?: "low" | "medium" | "high"
    summary?: "auto" | "concise" | "detailed"
  }
}

export type OutputItem = OutputMessage | FunctionCallOutput

export interface OutputMessage {
  id: string
  type: "message"
  role: "assistant"
  status: "in_progress" | "completed" | "incomplete"
  content: Array<OutputContentPart>
}

export interface OutputTextContent {
  type: "output_text"
  text: string
  annotations: Array<Annotation>
}

export interface RefusalContent {
  type: "refusal"
  refusal: string
}

export type OutputContentPart = OutputTextContent | RefusalContent

export interface FunctionCallOutput {
  id: string
  type: "function_call"
  call_id: string
  name: string
  arguments: string
  status: "in_progress" | "completed" | "failed"
}

export interface Annotation {
  type: "file_citation" | "url_citation" | "file_path"
  text?: string
  start_index?: number
  end_index?: number
}

export interface ResponseError {
  code: string
  message: string
}

export interface ResponseUsage {
  input_tokens: number
  input_tokens_details?: { cached_tokens: number }
  output_tokens: number
  output_tokens_details?: { reasoning_tokens: number }
  total_tokens: number
}

// =====================================================
// Streaming Event Types
// =====================================================

export interface ResponseCreatedEvent {
  type: "response.created"
  response: ResponseAPIResponse
}

export interface ResponseInProgressEvent {
  type: "response.in_progress"
  response: ResponseAPIResponse
}

export interface ResponseOutputItemAddedEvent {
  type: "response.output_item.added"
  output_index: number
  item: OutputItem
}

export interface ResponseContentPartAddedEvent {
  type: "response.content_part.added"
  item_id: string
  output_index: number
  content_index: number
  part: OutputContentPart
}

export interface ResponseOutputTextDeltaEvent {
  type: "response.output_text.delta"
  item_id: string
  output_index: number
  content_index: number
  delta: string
}

export interface ResponseOutputTextDoneEvent {
  type: "response.output_text.done"
  item_id: string
  output_index: number
  content_index: number
  text: string
}

export interface ResponseFunctionCallArgumentsDeltaEvent {
  type: "response.function_call_arguments.delta"
  item_id: string
  output_index: number
  delta: string
}

export interface ResponseFunctionCallArgumentsDoneEvent {
  type: "response.function_call_arguments.done"
  item_id: string
  output_index: number
  arguments: string
}

export interface ResponseContentPartDoneEvent {
  type: "response.content_part.done"
  item_id: string
  output_index: number
  content_index: number
  part: OutputContentPart
}

export interface ResponseOutputItemDoneEvent {
  type: "response.output_item.done"
  output_index: number
  item: OutputItem
}

export interface ResponseCompletedEvent {
  type: "response.completed"
  response: ResponseAPIResponse
}

export interface ResponseFailedEvent {
  type: "response.failed"
  response: ResponseAPIResponse
}

export interface ResponseIncompleteEvent {
  type: "response.incomplete"
  response: ResponseAPIResponse
}

export type ResponseStreamEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseOutputItemAddedEvent
  | ResponseContentPartAddedEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputItemDoneEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
  | ResponseIncompleteEvent

// =====================================================
// Stream State (for tracking during streaming translation)
// =====================================================

export interface ResponseAPIStreamState {
  responseId: string
  model: string
  createdAt: number
  messageStarted: boolean
  currentOutputIndex: number
  currentContentIndex: number
  messageItemId: string | null
  accumulatedText: string
  accumulatedToolCalls: Map<
    number,
    {
      id: string
      callId: string
      name: string
      args: string
      outputIndex: number
    }
  >
  outputItems: Array<OutputItem>
  usage: ResponseUsage
  payload: ResponseAPIPayload
}
