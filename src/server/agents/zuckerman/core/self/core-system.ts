import { streamText } from "ai";
import type { Tool, LanguageModel, ModelMessage } from "ai";
import { LLMProvider } from "@server/world/providers/llm/index.js";
import { ToolRegistry } from "@server/agents/zuckerman/tools/registry.js";
import { loadConfig } from "@server/world/config/index.js";
import { resolveAgentHomedir } from "@server/world/homedir/resolver.js";
import { IdentityLoader } from "../identity/identity-loader.js";
import { agentDiscovery } from "@server/agents/discovery.js";
import { UnifiedMemoryManager } from "../memory/manager.js";
import { formatMemoriesForPrompt } from "../memory/prompt-formatter.js";
import { System1BrainParts } from "./system1-brain-parts.js";
import { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import type { AgentEvent } from "./events.js";

const MAX_ITERATIONS = 50;

export class CoreSystem {
  constructor(
    private agentId: string,
    private emitEvent: (event: AgentEvent) => Promise<void>
  ) { }

  async run(
    runId: string,
    conversationId: string,
    message: string,
    conversationMessages: ModelMessage[]
  ): Promise<{
    runId: string;
    response: string;
    tokensUsed?: number;
  }> {
    console.log(`[CoreSystem] Starting run ${runId} for conversation ${conversationId}`);
    const {
      systemPrompt,
      llmModel,
      availableTools,
      memoryManager,
      temperature,
    } = await this.initialize(conversationId);
    console.log(`[CoreSystem] Initialized - tools: ${Object.keys(availableTools).length}, temp: ${temperature ?? 'default'}`);

    // Emit lifecycle start event
    await this.emitEvent({
      type: "stream.lifecycle",
      conversationId,
      runId,
      phase: "start",
      message,
    });

    // Build context if needed (simple proactive gathering)
    const contextResult = await System1BrainParts.buildContext(
      runId,
      message,
      conversationId,
      llmModel,
      availableTools
    );
    const enrichedMessage = contextResult.enrichedMessage;
    console.log(`[CoreSystem] Context built - enriched: ${enrichedMessage !== message}`);
    // Context gathering messages are internal - don't add to conversation

    // Get relevant memories
    const memoriesText = await memoryManager.getRelevantMemories(message, {
      limit: 50,
      types: ["semantic", "episodic", "procedural"],
    }).then(formatMemoriesForPrompt).catch((error) => {
      console.warn(`[CoreSystem] Memory retrieval failed:`, error);
      return "";
    });
    console.log(`[CoreSystem] Memories retrieved - length: ${memoriesText.length}`);

    // Start with existing conversation messages (excluding system messages)
    let messages: ModelMessage[] = conversationMessages.filter(m => m.role !== "system");
    
    for (let iterations = 0; iterations < MAX_ITERATIONS; iterations++) {
      console.log(`[CoreSystem] Iteration ${iterations + 1}/${MAX_ITERATIONS}`);
      
      // Build messages with system prompt
      const messagesWithSystem: ModelMessage[] = [
        {
          role: "system",
          content: `${systemPrompt}\n\n${memoriesText}`.trim(),
        },
        ...messages,
      ];

      // Add continuation prompt if last message was assistant
      if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
        messagesWithSystem.push({
          role: "user",
          content: "Please continue.",
        });
      }

      const streamResult = await streamText({
        model: llmModel,
        messages: messagesWithSystem,
        temperature,
        tools: Object.keys(availableTools).length > 0 ? availableTools : undefined,
      });

      let content = "";
      for await (const chunk of streamResult.textStream) {
        content += chunk;
        await this.emitEvent({
          type: "stream.token",
          conversationId,
          runId,
          token: chunk,
        });
      }

      // Handle tool calls
      const toolCalls = await streamResult.toolCalls;
      const usage = await streamResult.usage;
      const tokensUsed = usage?.totalTokens;

      // If there are tool calls, execute them and add to messages
      if (toolCalls?.length) {
        const { assistantMsg, toolResultMsgs } = await this.executeToolCalls(
          toolCalls,
          content,
          availableTools,
          messagesWithSystem,
          conversationId,
          runId
        );
        messages.push(assistantMsg, ...toolResultMsgs);
        continue;
      }

      // Validate only when about to finish and return response
      try {
        const validation = await System1BrainParts.validate(
          enrichedMessage,
          content,
          llmModel,
          availableTools
        );

        if (!validation.satisfied) {
          console.log(`[CoreSystem] Validation failed: ${validation.reason}`);
          const missing = validation.missing.length ? ` Missing: ${validation.missing.join(", ")}.` : "";
          await this.emitEvent({
            type: "think",
            conversationId,
            thought: `Validation: ${validation.reason}.${missing} Instructions: Try different approach to complete the task.`,
            runId
          });
          continue;
        }
      } catch (error) {
        console.warn(`[CoreSystem] Validation error:`, error);
      }

      // Add assistant response to messages
      messages.push({
        role: "assistant",
        content: content,
      });
      
      // Only save if responding to a real user message (not the internal "Please continue" prompt)
      // Check if last message before this assistant response was a user message
      const lastMessageBeforeAssistant = messages.length > 1 ? messages[messages.length - 2] : null;
      const isRespondingToUser = lastMessageBeforeAssistant?.role === "user";
      
      if (isRespondingToUser) {
        await this.emitEvent({ type: "write", conversationId, content, role: "assistant", runId });
      }
      console.log(`[CoreSystem] Completed - tokens: ${tokensUsed ?? 'N/A'}`);
      await this.emitEvent({ type: "stream.lifecycle", conversationId, runId, phase: "end", tokensUsed });
      return { runId, response: content, tokensUsed };
    }

    // Max iterations reached
    console.log(`[CoreSystem] Max iterations reached (${MAX_ITERATIONS})`);
    const finalResponse = "Task may require more iterations to complete.";
    await Promise.all([
      this.emitEvent({ type: "write", conversationId, content: finalResponse, role: "assistant", runId }),
      this.emitEvent({ type: "stream.lifecycle", conversationId, runId, phase: "end", tokensUsed: 0 }),
    ]);
    return { runId, response: finalResponse };
  }

  /**
   * Execute tool calls and return assistant message with tool calls + tool result messages
   */
  private async executeToolCalls(
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
    textContent: string,
    availableTools: Record<string, Tool>,
    contextMessages: ModelMessage[],
    conversationId: string,
    runId: string
  ): Promise<{ assistantMsg: ModelMessage; toolResultMsgs: ModelMessage[] }> {
    console.log(`[CoreSystem] Tool calls: ${toolCalls.map(t => t.toolName).join(", ")}`);
    
    // Create assistant message with tool calls
    const toolCallParts = toolCalls.map(tc => ({
      type: "tool-call" as const,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    }));
    
    const assistantMsg: ModelMessage = {
      role: "assistant",
      content: textContent 
        ? [{ type: "text" as const, text: textContent }, ...toolCallParts]
        : toolCallParts,
    };
    
    // Execute tools and create result messages
    const toolResultMsgs: ModelMessage[] = await Promise.all(
      toolCalls.map(async (toolCall): Promise<ModelMessage> => {
        await this.emitEvent({
          type: "stream.tool.call",
          conversationId,
          runId,
          tool: toolCall.toolName,
          toolArgs: typeof toolCall.input === "object" && toolCall.input !== null && !Array.isArray(toolCall.input)
            ? toolCall.input as Record<string, unknown>
            : {},
        });
        
        const tool = availableTools[toolCall.toolName];
        if (!tool?.execute) {
          const error = `Tool "${toolCall.toolName}" not found or has no execute function`;
          await this.emitEvent({
            type: "stream.tool.result",
            conversationId,
            runId,
            tool: toolCall.toolName,
            toolResult: error,
          });
          return this.createToolResultMessage(toolCall, error);
        }
        
        try {
          const result = await tool.execute(toolCall.input, {
            toolCallId: toolCall.toolCallId,
            messages: contextMessages,
          });
          const output = typeof result === "string" ? result : JSON.stringify(result);
          await this.emitEvent({
            type: "stream.tool.result",
            conversationId,
            runId,
            tool: toolCall.toolName,
            toolResult: output,
          });
          return this.createToolResultMessage(toolCall, output);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          await this.emitEvent({
            type: "stream.tool.result",
            conversationId,
            runId,
            tool: toolCall.toolName,
            toolResult: `Error: ${errorMsg}`,
          });
          return this.createToolResultMessage(toolCall, `Error: ${errorMsg}`);
        }
      })
    );
    
    return { assistantMsg, toolResultMsgs };
  }

  /**
   * Create a tool result message from a tool call and output
   */
  private createToolResultMessage(
    toolCall: { toolCallId: string; toolName: string },
    output: string
  ): ModelMessage {
    return {
      role: "tool" as const,
      content: [{
        type: "tool-result" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: "text" as const, value: output },
      }],
    };
  }

  private async initialize(
    conversationId: string
  ): Promise<{
    systemPrompt: string;
    llmModel: LanguageModel;
    availableTools: Record<string, Tool>;
    memoryManager: UnifiedMemoryManager;
    temperature: number | undefined;
  }> {
    const config = await loadConfig();
    const homedir = resolveAgentHomedir(config, this.agentId);

    const metadata = agentDiscovery.getMetadata(this.agentId);
    if (!metadata) {
      throw new Error(`Agent "${this.agentId}" not found in discovery service`);
    }

    const systemPrompt = await new IdentityLoader().getSystemPrompt(
      metadata.agentDir
    );
    const llmModel = await LLMProvider.getInstance().fastCheap();

    const toolRegistry = new ToolRegistry();
    const availableTools = Object.fromEntries(toolRegistry.getToolsMap());

    const memoryManager = UnifiedMemoryManager.create(homedir, this.agentId);

    // Get temperature from conversation entry
    const temperature = new ConversationManager(this.agentId)
      .getConversationEntry(conversationId)?.temperatureOverride;

    return {
      systemPrompt,
      llmModel,
      availableTools,
      memoryManager,
      temperature,
    };
  }

}
