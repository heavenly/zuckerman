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
import type { MemoryType } from "@server/agents/zuckerman/core/memory/types.js";
import { resolveMemorySearchConfig } from "@server/agents/zuckerman/core/memory/config.js";
import { LLMService } from "@server/world/providers/llm/llm-service.js";
import type { RunContext } from "@server/world/providers/llm/context.js";
import { formatMemoriesForPrompt } from "../memory/prompt-formatter.js";
import { ToolService } from "../../tools/index.js";
import { StreamEventEmitter } from "@server/world/communication/stream-emitter.js";
import { CriticismService } from "../system2/criticism/criticism-service.js";

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

    // Load prompts and build system prompt
    const prompts = await this.identityLoader.loadPrompts(this.agentDir);
    const systemPrompt = this.identityLoader.buildSystemPrompt(prompts);

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
    const llmService = new LLMService(context.llmModel, context.streamEmitter, context.runId);

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
      const toolService = new ToolService();
      const criticismService = new CriticismService(context.llmModel);

      while (true) {
        const conversation = this.conversationManager.getConversation(context.conversationId);
        const result = await llmService.call({
          messages: llmService.buildMessages(context, conversation),
          temperature: context.temperature,
          availableTools: context.availableTools,
        });

        // Handle final response (no tool calls)
        if (!result.toolCalls?.length) {
          try {
            const validation = await criticismService.run({
              userRequest: context.message,
              systemResult: result.content,
            });

            if (!validation.satisfied) {
              const missing = validation.missing.length ? ` Missing: ${validation.missing.join(', ')}.` : '';
              await this.conversationManager.addMessage(context.conversationId, "system", `Validation: ${validation.reason}.${missing} Instructions: Try different approach to complete the task.`, { runId: context.runId });
              continue;
            }
          } catch (error) {
            console.warn(`[self] Validation error:`, error);
          }

          await this.conversationManager.addMessage(context.conversationId, "assistant", result.content, { runId: context.runId });

          const response = { runId: context.runId, response: result.content, tokensUsed: result.tokensUsed?.total };
          await context.streamEmitter.emitLifecycleEnd(context.runId, result.tokensUsed?.total, result.content);
          return response;
        }

        // Handle tool calls
        const toolCalls = result.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
        }));
        await this.conversationManager.addMessage(context.conversationId, "assistant", "", { toolCalls, runId: context.runId });

        const toolResults = await toolService.executeTools(context, result.toolCalls);
        for (const toolResult of toolResults) {
          await this.conversationManager.addMessage(context.conversationId, "tool", toolResult.content, { toolCallId: toolResult.toolCallId, runId: context.runId });
        }
      }
    } catch (err) {
      console.error(`[ZuckermanRuntime] Error in run:`, err);
      await context.streamEmitter.emitLifecycleError(context.runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}

// Backward compatibility
export const ZuckermanRuntime = Self;
