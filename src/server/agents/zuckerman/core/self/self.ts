import { randomUUID } from "node:crypto";
import type { AgentRunParams, AgentRunResult } from "@server/world/runtime/agents/types.js";
import { loadConfig } from "@server/world/config/index.js";
import { resolveAgentHomedir } from "@server/world/homedir/resolver.js";
import { UnifiedMemoryManager } from "@server/agents/zuckerman/core/memory/manager.js";
import { resolveMemorySearchConfig } from "@server/agents/zuckerman/core/memory/config.js";
import { CoreSystem } from "./core-system.js";
import type { AgentEvent } from "./events.js";
import { convertToModelMessages } from "@server/world/providers/llm/helpers.js";

export type EventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void | Promise<void>;

export class Self {
  readonly agentId: string;
  private memoryManager!: UnifiedMemoryManager;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async initialize(): Promise<void> {
    try {
      const config = await loadConfig();
      const homedir = resolveAgentHomedir(config, this.agentId);
      this.memoryManager = UnifiedMemoryManager.create(homedir, this.agentId);

      const memorySearchConfig = config.agent?.memorySearch;
      if (memorySearchConfig) {
        const resolvedConfig = resolveMemorySearchConfig(memorySearchConfig, homedir, this.agentId);
        if (resolvedConfig) {
          await this.memoryManager.initializeDatabase(resolvedConfig, this.agentId);
        }
      }
    } catch (error) {
      console.warn(`[Self] Initialization failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const { conversationId, message, runId = randomUUID() } = params;

    try {
      const coreSystem = new CoreSystem(this.agentId, (event) => this.emit(event));
      // Convert ConversationMessage[] to ModelMessage[]
      const modelMessages = params.conversationMessages 
        ? convertToModelMessages(params.conversationMessages)
        : [];
      return await coreSystem.run(
        runId,
        conversationId,
        message,
        modelMessages
      );
    } catch (err) {
      await this.emit({
        type: "stream.lifecycle",
        conversationId,
        runId,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Register an event handler for a specific event type
   */
  on<T extends AgentEvent>(eventType: T["type"], handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    const handlers = this.eventHandlers.get(eventType)!;
    handlers.add(handler as EventHandler);
    return () => handlers.delete(handler as EventHandler);
  }

  /**
   * Emit an event to all registered handlers
   */
  async emit(event: AgentEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.type);
    if (!handlers) return;

    await Promise.all(
      Array.from(handlers).map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          console.error(`[Self] Error in event handler for "${event.type}":`, error);
        }
      })
    );
  }
}
