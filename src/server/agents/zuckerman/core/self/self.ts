import { randomUUID } from "node:crypto";
import type { AgentRuntime, AgentRunParams, AgentRunResult } from "@server/world/runtime/agents/types.js";
import type { LLMTool } from "@server/world/providers/llm/types.js";
import { loadConfig } from "@server/world/config/index.js";
import { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import { ToolRegistry } from "@server/agents/zuckerman/tools/registry.js";
import { LLMManager } from "@server/world/providers/llm/index.js";
import { IdentityLoader } from "../identity/identity-loader.js";
import { agentDiscovery } from "@server/agents/discovery.js";
import { resolveAgentHomedir } from "@server/world/homedir/resolver.js";
import { UnifiedMemoryManager } from "@server/agents/zuckerman/core/memory/manager.js";
import { resolveMemorySearchConfig } from "@server/agents/zuckerman/core/memory/config.js";
import { LLMService } from "@server/world/providers/llm/llm-service.js";
import type { RunContext } from "@server/world/providers/llm/context.js";
import { formatMemoriesForPrompt } from "../memory/prompt-formatter.js";
import { StreamEventEmitter } from "@server/world/communication/stream-emitter.js";
import { System1 } from "../system1/system1-central.js";
import { System2 } from "../system2/system2-central.js";

export class Self {
  readonly agentId: string;
  private identityLoader: IdentityLoader;
  private memoryManager!: UnifiedMemoryManager;
  private llmManager: LLMManager;
  private conversationManager: ConversationManager;
  private toolRegistry: ToolRegistry;
  private readonly agentDir: string;

  constructor(agentId: string, conversationManager?: ConversationManager, llmManager?: LLMManager, identityLoader?: IdentityLoader) {
    this.agentId = agentId;
    this.conversationManager = conversationManager || new ConversationManager(this.agentId);
    this.toolRegistry = new ToolRegistry();
    this.llmManager = llmManager || LLMManager.getInstance();
    this.identityLoader = identityLoader || new IdentityLoader();

    // Get agent directory from discovery service
    const metadata = agentDiscovery.getMetadata(this.agentId);
    if (!metadata) {
      throw new Error(`Agent "${this.agentId}" not found in discovery service`);
    }
    this.agentDir = metadata.agentDir;
  }

  /**
   * Initialize the agent - called once when agent is created
   */
  async initialize(): Promise<void> {
    try {
      const config = await loadConfig();
      const homedir = resolveAgentHomedir(config, this.agentId);
      this.memoryManager = UnifiedMemoryManager.create(homedir, this.agentId);

      // Initialize database for vector search if memory search is enabled
      const memorySearchConfig = config.agent?.memorySearch;
      if (memorySearchConfig) {
        const resolvedConfig = resolveMemorySearchConfig(memorySearchConfig, homedir, this.agentId);
        if (resolvedConfig) {
          await this.memoryManager.initializeDatabase(resolvedConfig, this.agentId);
        }
      }
    } catch (error) {
      console.warn(`[ZuckermanRuntime] Initialization failed:`, error instanceof Error ? error.message : String(error));
      // Continue without database - memory search will be disabled
    }
  }

  /**
   * Build execution context for a run
   */
  private async buildRunContext(params: AgentRunParams): Promise<RunContext> {
    const { conversationId, message, temperature, securityContext, stream } = params;
    const runId = randomUUID();

    // Update tool registry conversation ID for batch tool context
    this.toolRegistry.setConversationId(conversationId);

    // Get LLM model and config
    const config = await loadConfig();
    const llmModel = await this.llmManager.fastCheap();
    const homedir = resolveAgentHomedir(config, this.agentId);

    // Get system prompt
    const systemPrompt = await this.identityLoader.getSystemPrompt(this.agentDir);

    // Prepare tools for LLM
    const availableTools: LLMTool[] = this.toolRegistry.list().map(t => ({
      type: "function" as const,
      function: t.definition
    }));

    // Build context
    const context: RunContext = {
      agentId: this.agentId,
      conversationId,
      runId,
      message,
      temperature,
      securityContext,
      homedir,
      memoryManager: this.memoryManager,
      toolRegistry: this.toolRegistry,
      llmModel,
      streamEmitter: new StreamEventEmitter(stream, this.agentId, conversationId),
      availableTools,
      systemPrompt,
      relevantMemoriesText: "",
    };

    return context;
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const context = await this.buildRunContext(params);

    // Handle channel metadata
    if (params.channelMetadata) {
      await this.conversationManager.updateChannelMetadata(context.conversationId, params.channelMetadata);
    }

    // Persist user message
    await this.conversationManager.addMessage(context.conversationId, "user", context.message, { runId: context.runId });

    // Get relevant memories
    try {
      const memoryResult = await context.memoryManager.getRelevantMemories(context.message, {
        limit: 50,
        types: ["semantic", "episodic", "procedural"],
      });
      context.relevantMemoriesText = formatMemoriesForPrompt(memoryResult);
    } catch (error) {
      console.warn(`[self] Memory retrieval failed:`, error);
    }

    // Remember memories (async)
    const conversationContext = this.conversationManager.getConversation(context.conversationId)?.messages.slice(-3).map(m => m.content).join("\n");
    context.memoryManager.onNewMessage(context.message, context.conversationId, conversationContext)
      .catch(err => console.warn(`[self] Failed to remember memories:`, err));

    await context.streamEmitter.emitLifecycleStart(context.runId, context.message);

    try {
      console.log(`[Self] Selecting system for message: "${context.message.substring(0, 100)}${context.message.length > 100 ? '...' : ''}"`);
      const selectedSystem = await this.selectSystem(context);
      console.log(`[Self] Selected ${selectedSystem.toUpperCase()} for runId: ${context.runId}`);
      
      if (selectedSystem === "system2") {
        console.log(`[Self] Routing to System2`);
        const system2 = new System2(this.conversationManager, context);
        return await system2.run();
      } else {
        console.log(`[Self] Routing to System1`);
        const system1 = new System1(this.conversationManager, context);
        return await system1.run({useContextBuilder: true});
      }
    } catch (err) {
      console.error(`[ZuckermanRuntime] Error in run:`, err);
      await context.streamEmitter.emitLifecycleError(context.runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Determine which system (1 or 2) should handle the current message
   */
  private async selectSystem(context: RunContext): Promise<"system1" | "system2"> {
    console.log(`[Self] Starting system selection for runId: ${context.runId}`);
    const llmService = new LLMService(context.llmModel, context.streamEmitter, context.runId);
    
    const conversation = this.conversationManager.getConversation(context.conversationId);
    const conversationContext = conversation?.messages.slice(-3).map(m => `${m.role}: ${m.content}`).join("\n") || "No previous messages";
    
    const systemSelectionPrompt = `You ARE Zuckerman. You are thinking through your Self - your central coordinator deciding which processing system you should use.

CONTEXT: You ARE Zuckerman. You are an autonomous AI agent operating completely independently. You have no human assistance and must rely entirely on your own capabilities, tools, and reasoning. You need to decide which processing system you should use to handle what you need to do.

IMPORTANT: You ARE Zuckerman. You are operating completely independently. There is no one else who can help you - you must rely entirely on your own capabilities, tools, and reasoning. All decisions must be made by you alone.

System 1: Fast, intuitive, reactive processing. Use for:
- Simple questions and answers
- Direct tool usage requests
- Quick information retrieval
- Straightforward tasks
- Casual conversation

System 2: Deliberate, analytical, multi-module processing. Use for:
- Complex problem-solving requiring multiple steps
- Tasks needing planning and decomposition
- Situations requiring reflection and criticism
- Multi-faceted requests with multiple considerations
- Tasks that benefit from parallel module evaluation

What you need to do: "${context.message}"

Conversation context: ${conversationContext}

Respond with ONLY "system1" or "system2" - no other text.`;

    try {
      console.log(`[Self] Calling LLM for system selection`);
      const result = await llmService.call({
        messages: [
          {
            role: "system",
            content: systemSelectionPrompt,
          },
        ],
        temperature: 0.1,
        availableTools: [],
      });

      const rawSelection = result.content.trim();
      const selection = rawSelection.toLowerCase();
      console.log(`[Self] LLM raw response: "${rawSelection}"`);
      
      const finalSelection = (selection === "system2" || selection.includes("2")) ? "system2" : "system1";
      console.log(`[Self] Parsed selection: ${finalSelection}`);
      
      return finalSelection;
    } catch (error) {
      console.warn(`[Self] System selection failed, defaulting to System1:`, error);
      return "system1";
    }
  }
}

// Backward compatibility
export const ZuckermanRuntime = Self;
