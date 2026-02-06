import { randomUUID } from "node:crypto";
import type { AgentRuntime, AgentRunParams, AgentRunResult } from "@server/world/runtime/agents/types.js";
import type { LLMTool } from "@server/world/providers/llm/types.js";
import { loadConfig } from "@server/world/config/index.js";
import { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import { ToolRegistry } from "@server/agents/zuckerman/tools/registry.js";
import { LLMManager } from "@server/world/providers/llm/index.js";
import { IdentityLoader, type LoadedPrompts } from "../identity/identity-loader.js";
import { agentDiscovery } from "@server/agents/discovery.js";
import { resolveAgentHomedir } from "@server/world/homedir/resolver.js";
import { UnifiedMemoryManager } from "@server/agents/zuckerman/core/memory/manager.js";
import { activityRecorder } from "@server/agents/zuckerman/activity/index.js";
import { resolveMemorySearchConfig } from "@server/agents/zuckerman/core/memory/config.js";
import { LLMService } from "./llm-service.js";
import type { RunContext } from "./context.js";
import { formatMemoriesForPrompt } from "../memory/prompt-formatter.js";
import { ToolService } from "../../tools/index.js";
import { StreamEventEmitter } from "@server/world/communication/stream-emitter.js";
import { ValidationService } from "../planning/validation-service.js";

export class Awareness implements AgentRuntime {
  readonly agentId = "zuckerman";
  
  private identityLoader: IdentityLoader;
  private memoryManager!: UnifiedMemoryManager;

  private llmManager: LLMManager;
  private conversationManager: ConversationManager;
  private toolRegistry: ToolRegistry;

  
  // Load prompts from agent's core directory (where markdown files are)
  private readonly agentDir: string;

  constructor(conversationManager?: ConversationManager, llmManager?: LLMManager, identityLoader?: IdentityLoader) {
    this.conversationManager = conversationManager || new ConversationManager(this.agentId);
    // Initialize tool registry without conversationId - will be set per-run
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
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ZuckermanRuntime] Initialization failed:`, message);
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
      streamEmitter: new StreamEventEmitter(stream),
      conversation: this.conversationManager.getConversation(conversationId) ?? null,
      messages: [],
      availableTools,
      systemPrompt,
      relevantMemoriesText: "",
    };

    return context;
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    // Build awareness context (memory, messages, prompts)
    const context = await this.buildRunContext(params);

    // Handle channel metadata if provided (for tool access)
    if (params.channelMetadata && context.conversation) {
      await this.conversationManager.updateChannelMetadata(
        context.conversationId,
        params.channelMetadata
      );
    }

    // Persist user message to conversation (agent owns message persistence)
    if (context.conversation) {
      await this.conversationManager.addMessage(
        context.conversationId,
        "user",
        context.message,
        { runId: context.runId }
      );
    }

    // Get relevant memories directly from memory manager
    try {
      const memoryResult = await context.memoryManager.getRelevantMemories(context.message, {
        limit: 50,
        types: ["semantic", "episodic", "procedural"],
      });
      context.relevantMemoriesText = formatMemoriesForPrompt(memoryResult);
    } catch (error) {
      console.warn(`[Awareness] Memory retrieval failed:`, error);
      context.relevantMemoriesText = "";
    }

    // Initialize LLM service
    const llmService = new LLMService(context.llmModel, context.streamEmitter, context.runId);

    // Get fresh conversation state (includes the user message we just added)
    context.conversation = this.conversationManager.getConversation(context.conversationId) ?? null;

    // Build messages from conversation history (includes user message)
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
      console.warn(`[Awareness] Failed to remember memories:`, err);
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
      const validationService = new ValidationService(context.llmModel);

      // Unified loop: handles initial call and recursive tool calls
      while (true) {
        // Call LLM
        const result = await llmService.call({
          messages: context.messages,
          temperature: context.temperature,
          availableTools: context.availableTools,
        });

        // If no tool calls, we're about to end - validate first
        if (!result.toolCalls || result.toolCalls.length === 0) {
          // Add final assistant response to context messages
          context.messages.push({
            role: "assistant",
            content: result.content,
          });

          // VALIDATE before ending
          try {
            const validation = await validationService.validate({
              userRequest: context.message,
              systemResult: result.content,
            });

            console.log(`[Awareness] Validation:`, validation);

            // If NOT satisfied, add feedback and continue loop
            if (!validation.satisfied) {
              const missingText = validation.missing.length > 0
                ? ` Missing: ${validation.missing.join(', ')}.`
                : '';
              const feedback = `Validation: ${validation.reason}.${missingText} Please try again to fully satisfy the user's request.`;

              context.messages.push({
                role: "system",
                content: feedback,
              });

              // Continue loop - LLM will see feedback and try again
              continue;
            }
          } catch (error) {
            // If validation fails, log and proceed (don't block)
            console.warn(`[Awareness] Validation failed:`, error);
          }

          // If satisfied (or validation failed), proceed with normal end
          // Persist final response to conversation
          if (context.conversation) {
            await this.conversationManager.addMessage(
              context.conversationId,
              "assistant",
              result.content,
              { runId: context.runId }
            );
          }

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
        const assistantMessageWithToolCalls = {
          role: "assistant" as const,
          content: "",
          toolCalls: result.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
          })),
        };
        context.messages.push(assistantMessageWithToolCalls);

        // Persist assistant message with tool calls
        if (context.conversation) {
          await this.conversationManager.addMessage(
            context.conversationId,
            "assistant",
            "",
            {
              toolCalls: assistantMessageWithToolCalls.toolCalls,
              runId: context.runId,
            }
          );
        }

        const toolCallResults = await toolService.executeTools(context, result.toolCalls);

        // Add tool results to context and persist them
        for (const toolResult of toolCallResults) {
          context.messages.push(toolResult);

          // Persist tool result
          if (context.conversation) {
            await this.conversationManager.addMessage(
              context.conversationId,
              "tool",
              toolResult.content,
              {
                toolCallId: toolResult.toolCallId,
                runId: context.runId,
              }
            );
          }
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

  /**
   * Load agent prompts (public API for inspection/debugging)
   */
  async loadPrompts(): Promise<{ files: Map<string, string> }> {
    const prompts = await this.identityLoader.loadPrompts(this.agentDir);
    return { files: prompts.files };
  }

  /**
   * Clear caches (public API for hot reload)
   */
  clearCache(): void {
    // Clear identity loader cache if available
    if (this.identityLoader.clearCache) {
      this.identityLoader.clearCache(this.agentDir);
    }
  }
}

// Backward compatibility
export const ZuckermanRuntime = Awareness;
