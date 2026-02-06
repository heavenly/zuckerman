import { randomUUID } from "node:crypto";
import type { AgentRuntime, AgentRunParams, AgentRunResult } from "@server/world/runtime/agents/types.js";
import type { LLMTool } from "@server/world/providers/llm/types.js";
import { loadConfig } from "@server/world/config/index.js";
import { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import { ZuckermanToolRegistry } from "@server/agents/zuckerman/tools/registry.js";
import { LLMManager } from "@server/world/providers/llm/index.js";
import { PromptLoader, type LoadedPrompts } from "../identity/identity-loader.js";
import { agentDiscovery } from "@server/agents/discovery.js";
import { resolveAgentHomedir } from "@server/world/homedir/resolver.js";
import { UnifiedMemoryManager } from "@server/agents/zuckerman/core/memory/manager.js";
import { activityRecorder } from "@server/world/activity/index.js";
import { resolveMemorySearchConfig } from "@server/agents/zuckerman/core/memory/config.js";
import { LLMService } from "./llm-service.js";
import type { RunContext } from "./context.js";
import { formatMemoriesForPrompt } from "../memory/prompt-formatter.js";
import { ToolService } from "../../tools/index.js";
import { StreamEventEmitter } from "@server/world/communication/stream-emitter.js";

export class ZuckermanAwareness implements AgentRuntime {
  readonly agentId = "zuckerman";
  
  private promptLoader: PromptLoader;
  private llmManager: LLMManager;
  private conversationManager: ConversationManager;
  private toolRegistry: ZuckermanToolRegistry;

  private memoryManager: UnifiedMemoryManager | null = null;
  
  // Load prompts from agent's core directory (where markdown files are)
  private readonly agentDir: string;

  constructor(conversationManager?: ConversationManager, llmManager?: LLMManager, promptLoader?: PromptLoader) {
    this.conversationManager = conversationManager || new ConversationManager(this.agentId);
    // Initialize tool registry without conversationId - will be set per-run
    this.toolRegistry = new ZuckermanToolRegistry();
    this.llmManager = llmManager || LLMManager.getInstance();
    this.promptLoader = promptLoader || new PromptLoader();
    
    // Get agent directory from discovery service
    const metadata = agentDiscovery.getMetadata(this.agentId);
    if (!metadata) {
      throw new Error(`Agent "${this.agentId}" not found in discovery service`);
    }
    this.agentDir = metadata.agentDir;
  }

  /**
   * Initialize memory manager with homedir directory
   */
  private initializeMemoryManager(homedir: string): void {
    if (!this.memoryManager) {
      this.memoryManager = UnifiedMemoryManager.create(homedir, this.agentId);
    }
  }

  /**
   * Get memory manager instance (must be initialized first)
   */
  private getMemoryManager(): UnifiedMemoryManager {
    if (!this.memoryManager) {
      throw new Error("Memory manager not initialized. Call initializeMemoryManager first.");
    }
    return this.memoryManager;
  }

  /**
   * Initialize the agent - called once when agent is created
   */
  async initialize(): Promise<void> {
    try {
      const config = await loadConfig();
      const homedir = resolveAgentHomedir(config, this.agentId);
      
      // Initialize memory manager
      this.initializeMemoryManager(homedir);
      
      // Initialize database for vector search if memory search is enabled
      const memorySearchConfig = config.agent?.memorySearch;
      if (memorySearchConfig) {
        const resolvedConfig = resolveMemorySearchConfig(memorySearchConfig, homedir, this.agentId);
        if (resolvedConfig) {
          await this.getMemoryManager().initializeDatabase(resolvedConfig, this.agentId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ZuckermanRuntime] Initialization failed:`, message);
      // Continue without database - memory search will be disabled
    }
  }

  async loadPrompts(): Promise<LoadedPrompts> {
    return this.promptLoader.loadPrompts(this.agentDir);
  }

  async buildSystemPrompt(
    prompts: LoadedPrompts,
    homedir?: string,
  ): Promise<string> {
    const basePrompt = this.promptLoader.buildSystemPrompt(prompts);
    const parts: string[] = [basePrompt];
    
    
    // Add tool information to system prompt
    const tools = this.toolRegistry.list();
    if (tools.length > 0) {
      const toolDescriptions = tools.map((tool) => {
        return `- **${tool.definition.name}**: ${tool.definition.description}`;
      }).join("\n");
      
      const toolSection = `\n\n## Available Tools\n\nUse these tools to perform actions. When you need to execute a command, read a file, or perform any operation, call the appropriate tool with the required parameters. Tools execute operations directly - you don't need to show commands or code.\n\n${toolDescriptions}`;
      
      parts.push(toolSection);
    }
    
    return parts.join("\n\n---\n\n");
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

    // Initialize memory manager if not already initialized
    this.initializeMemoryManager(homedir);
    const memoryManager = this.getMemoryManager();

    // Load prompts and build system prompt
    const prompts = await this.loadPrompts();
    const systemPrompt = await this.buildSystemPrompt(prompts, homedir);

    // Prepare tools for LLM
    const llmTools: LLMTool[] = this.toolRegistry.list().map(t => ({
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
      memoryManager,
      toolRegistry: this.toolRegistry,
      llmModel,
      streamEmitter: new StreamEventEmitter(stream),
      conversation: this.conversationManager.getConversation(conversationId) ?? null,
      messages: [],
      llmTools,
      systemPrompt,
      relevantMemoriesText: "",
    };

    return context;
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    // Build awareness context (memory, messages, prompts)
    const context = await this.buildRunContext(params);

    // Get relevant memories directly from memory manager
    try {
      const memoryResult = await context.memoryManager.getRelevantMemories(context.message, {
        limit: 50,
        types: ["semantic", "episodic", "procedural"],
      });
      context.relevantMemoriesText = formatMemoriesForPrompt(memoryResult);
    } catch (error) {
      console.warn(`[ZuckermanAwareness] Memory retrieval failed:`, error);
      context.relevantMemoriesText = "";
    }

    // Initialize LLM service
    const llmService = new LLMService(context.llmModel, context.streamEmitter, context.runId);

    // Build messages
    context.messages = llmService.buildMessages(context);

    // Remember memories from new message (async, don't block)
    const conversationContext = context.conversation
      ? context.conversation.messages.slice(-3).map(m => m.content).join("\n")
      : undefined;
    
    context.memoryManager.onNewMessage(
      context.message,
      context.conversationId,
      conversationContext
    ).catch(err => {
      console.warn(`[ZuckermanAwareness] Failed to remember memories:`, err);
    });

    // Record agent run start
    await activityRecorder.recordAgentRunStart(
      context.agentId,
      context.conversationId,
      context.runId,
      context.message,
    );

    await context.streamEmitter.emitLifecycleStart(context.runId);

    try {
      const toolService = new ToolService();

      // Unified loop: handles initial call and recursive tool calls
      while (true) {
        // Call LLM
        const result = await llmService.call({
          messages: context.messages,
          temperature: context.temperature,
          tools: context.llmTools,
        });

        // If no tool calls, we're done
        if (!result.toolCalls || result.toolCalls.length === 0) {
          await context.streamEmitter.emitLifecycleEnd(context.runId, result.tokensUsed?.total);

          await activityRecorder.recordAgentRunComplete(
            context.agentId,
            context.conversationId,
            context.runId,
            result.content,
            result.tokensUsed?.total,
            undefined,
          );

          return {
            runId: context.runId,
            response: result.content,
            tokensUsed: result.tokensUsed?.total,
          };
        }

        // Handle tool calls: add assistant message, execute tools, add results
        context.messages.push({
          role: "assistant",
          content: "",
          toolCalls: result.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
          })),
        });

        const toolCallResults = await toolService.executeTools(context, result.toolCalls);

        for (const toolResult of toolCallResults) {
          context.messages.push(toolResult);
        }

        // Loop continues to call LLM again with tool results
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await context.streamEmitter.emitLifecycleError(context.runId, errorMessage);

      await activityRecorder.recordAgentRunError(
        context.agentId,
        context.conversationId,
        context.runId,
        errorMessage,
      );
      
      console.error(`[ZuckermanRuntime] Error in run:`, err);
      throw err;
    }
  }

  clearCache(): void {
    this.promptCacheClear();
    this.llmManager.clearCache();
  }

  private promptCacheClear(): void {
    if (this.agentDir) {
      this.promptLoader.clearCache(this.agentDir);
    } else {
      this.promptLoader.clearCache();
    }
  }
}

// Backward compatibility
export const ZuckermanRuntime = ZuckermanAwareness;
