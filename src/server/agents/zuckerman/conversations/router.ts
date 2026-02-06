import type { Conversation, ConversationId, ConversationKey, ConversationLabel, ConversationType } from "./types.js";
import { ConversationManager } from "./manager.js";
import { loadConversationStore, resolveConversationStorePath } from "./store.js";
import { deriveConversationKey } from "./index.js";

/**
 * Router for resolving conversation keys to conversation IDs
 * Handles creation and lookup of conversations based on keys
 */
export class ConversationRouter {
  private conversationManager: ConversationManager;
  private agentId: string;

  constructor(agentId: string, conversationManager?: ConversationManager) {
    this.agentId = agentId;
    this.conversationManager = conversationManager || new ConversationManager(agentId);
  }

  /**
   * Get or create a conversation by key
   * Looks up existing conversation in store, creates if not found
   */
  getOrCreateConversation(
    conversationKey: ConversationKey,
    type: ConversationType,
    label?: ConversationLabel,
    agentId?: string,
  ): Conversation {
    // Try to find existing conversation by key
    const storePath = resolveConversationStorePath(this.agentId);
    const store = loadConversationStore(storePath);
    const existingEntry = store[conversationKey];

    if (existingEntry) {
      // Conversation exists - get it from manager
      const existing = this.conversationManager.getConversation(existingEntry.conversationId);
      if (existing) {
        return existing.conversation;
      }
    }

    // Create new conversation
    const conversation = this.conversationManager.createConversation(
      label || this.extractLabelFromKey(conversationKey),
      type,
      agentId || this.agentId,
    );

    return conversation;
  }

  /**
   * Get or create main conversation for an agent
   */
  getOrCreateMainConversation(agentId?: string): Conversation {
    const mainKey = deriveConversationKey(this.agentId, "main");
    return this.getOrCreateConversation(mainKey, "main", "main", agentId || this.agentId);
  }

  /**
   * Resolve conversation key to conversation ID
   * Returns existing ID if found, otherwise creates new conversation
   */
  resolveConversationId(
    conversationKey: ConversationKey,
    type: ConversationType,
    label?: ConversationLabel,
    agentId?: string,
  ): ConversationId {
    const conversation = this.getOrCreateConversation(conversationKey, type, label, agentId);
    return conversation.id;
  }

  /**
   * Extract a readable label from a conversation key
   */
  private extractLabelFromKey(key: ConversationKey): ConversationLabel {
    // Parse key format: agent:{agentId}:{type}:{label} or agent:{agentId}:main
    const parts = key.split(":");
    if (parts.length >= 4) {
      // Has label part
      return parts.slice(3).join(":");
    }
    if (parts.length === 3 && parts[2] === "main") {
      return "main";
    }
    // Fallback to key itself
    return key;
  }

  /**
   * Get the underlying conversation manager
   */
  getManager(): ConversationManager {
    return this.conversationManager;
  }
}
