import type { ConversationId, ConversationState, Conversation, ConversationKey, ConversationType, ConversationLabel } from "@server/agents/zuckerman/conversations/types.js";
import type { SecurityContext } from "@server/world/execution/security/types.js";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface StreamEvent {
  type: "lifecycle" | "token" | "tool.call" | "tool.result" | "thinking" | "done";
  data: {
    phase?: "start" | "end" | "error";
    error?: string;
    token?: string;
    tool?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    thinking?: string;
    runId?: string;
    tokensUsed?: number;
    toolsUsed?: string[];
    response?: string;
    // Additional context fields
    message?: string;
    timestamp?: number;
  };
}

export type StreamCallback = (event: StreamEvent) => void | Promise<void>;

export interface AgentRunParams {
  conversationId: ConversationId;
  message: string;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  securityContext: SecurityContext;
  stream?: StreamCallback;
  /**
   * Channel metadata for tool access (optional, set by world when routing from channels)
   */
  channelMetadata?: {
    channel?: string;
    to?: string;
    accountId?: string;
  };
}

export interface AgentRunResult {
  response: string;
  runId: string;
  tokensUsed?: number;
  toolsUsed?: string[];
}

/**
 * Agent runtime interface - all agent runtimes must implement this
 * Includes conversation management methods for world code to use
 */
export interface AgentRuntime {
  /**
   * Agent identifier
   */
  readonly agentId: string;

  /**
   * Initialize the agent (called once when agent is created)
   */
  initialize?(): Promise<void>;

  /**
   * Run the agent with given parameters
   */
  run(params: AgentRunParams): Promise<AgentRunResult>;

  /**
   * Load agent prompts (for inspection/debugging)
   */
  loadPrompts?(): Promise<unknown>;

  /**
   * Clear caches (for hot reload)
   */
  clearCache?(): void;

  /**
   * Get conversation by ID (read-only)
   */
  getConversation?(conversationId: ConversationId): ConversationState | undefined;

  /**
   * List all conversations (read-only)
   */
  listConversations?(): Conversation[];

  /**
   * Create a new conversation (for routing/setup)
   */
  createConversation?(
    label: string,
    type?: "main" | "group" | "channel",
    agentId?: string
  ): Conversation;

  /**
   * Delete a conversation (for API operations)
   */
  deleteConversation?(conversationId: ConversationId): boolean;

  /**
   * Get or create main conversation (for routing)
   */
  getOrCreateMainConversation?(agentId?: string): Conversation;

  /**
   * Get or create conversation by key (for routing from world)
   */
  getOrCreateConversationByKey?(
    conversationKey: ConversationKey,
    type: ConversationType,
    label?: ConversationLabel,
  ): Conversation;
}
