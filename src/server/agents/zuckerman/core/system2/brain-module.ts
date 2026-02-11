import type { RunContext } from "@server/world/providers/llm/context.js";
import { LLMService } from "@server/world/providers/llm/llm-service.js";
import type { LLMMessage } from "@server/world/providers/llm/types.js";
import { ToolService } from "../../tools/index.js";
import { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import type { BrainPart, BrainGoal } from "./types.js";
import { WorkingMemoryManager } from "./working-memory.js";
import { System2DebugLogger } from "./debug.js";

export interface BrainModuleResult {
  completed: boolean;
  result: string;
  toolCallsMade: number;
}

export class BrainModule {
  constructor(
    private conversationManager: ConversationManager,
    private context: RunContext,
    private brainPart: BrainPart,
    private goal: BrainGoal,
    private workingMemoryManager: WorkingMemoryManager,
    private historyText: string,
    private debugLogger: System2DebugLogger
  ) {}

  async run(): Promise<BrainModuleResult> {
    const llmService = new LLMService(this.context.llmModel, this.context.streamEmitter, this.context.runId);
    const toolService = new ToolService();
    
    let toolCallsMade = 0;
    const maxIterations = this.brainPart.maxIterations ?? 50;
    let iterations = 0;

    console.log(`[BrainModule] Starting ${this.brainPart.name} (${this.brainPart.id}) - Goal: ${this.goal.description}`);

    // Add initial goal message to conversation
    const goalMessage = `[Brain Part: ${this.brainPart.name}] Goal: ${this.goal.description}`;
    await this.conversationManager.addMessage(
      this.context.conversationId,
      "system",
      goalMessage,
      { runId: this.context.runId }
    );
    await this.debugLogger.logConversationMessage("system", goalMessage, { runId: this.context.runId });

    while (iterations < maxIterations) {
      iterations++;
      console.log(`[BrainModule] ${this.brainPart.name} iteration ${iterations}/${maxIterations}`);
      
      const conversation = this.conversationManager.getConversation(this.context.conversationId);
      
      // Get current working memory
      const workingMemory = this.workingMemoryManager.getState();
      await this.debugLogger.logBrainPartIteration(
        this.brainPart.id,
        this.brainPart.name,
        iterations,
        maxIterations,
        workingMemory.memories
      );
      
      // Build messages with brain part prompt (generated with goal, working memory, and history)
      const brainPartPrompt = this.brainPart.getPrompt(this.goal.description, workingMemory.memories, this.historyText);
      await this.debugLogger.logBrainPartPrompt(this.brainPart.id, this.brainPart.name, brainPartPrompt);
      
      // Build messages: use brain part prompt as system prompt, then add conversation messages
      // Don't use buildMessages() as it includes systemPrompt and relevantMemoriesText which conflict with brain part prompt
      const messages: LLMMessage[] = [
        { role: "system", content: brainPartPrompt },
      ];
      
      // Add conversation messages (excluding system messages to avoid duplication)
      if (conversation) {
        for (const msg of conversation.messages) {
          if (msg.ignore || msg.role === "system") continue;
          messages.push({
            role: msg.role as "user" | "assistant" | "tool",
            content: msg.content,
            toolCalls: msg.toolCalls,
            toolCallId: msg.toolCallId,
          });
        }
      }

      const toolsAllowed = this.brainPart.toolsAllowed !== false; // Default to true if not specified
      const availableTools = toolsAllowed ? this.context.availableTools : [];
      const result = await llmService.call({
        messages,
        temperature: this.context.temperature,
        availableTools,
      });

      await this.debugLogger.logLLMCall(
        `brain_part_${this.brainPart.id}_iteration_${iterations}`,
        messages,
        result,
        this.context.temperature,
        availableTools
      );

      // Check if goal is complete (no tool calls means brain part thinks it's done)
      if (!result.toolCalls?.length) {
        // Brain part indicates completion
        const completionMessage = result.content || `Goal "${this.goal.description}" completed by ${this.brainPart.name}`;
        
        console.log(`[BrainModule] ${this.brainPart.name} completed successfully after ${iterations} iterations`);
        
        await this.conversationManager.addMessage(
          this.context.conversationId,
          "assistant",
          completionMessage,
          { runId: this.context.runId }
        );
        await this.debugLogger.logConversationMessage("assistant", completionMessage, { runId: this.context.runId });

        return {
          completed: true,
          result: completionMessage,
          toolCallsMade,
        };
      }

      // Handle tool calls
      toolCallsMade += result.toolCalls.length;
      console.log(`[BrainModule] ${this.brainPart.name} making ${result.toolCalls.length} tool call(s): ${result.toolCalls.map(tc => tc.name).join(", ")}`);
      
      const toolCalls = result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
      }));
      
      const assistantMessage = result.content || "";
      await this.conversationManager.addMessage(
        this.context.conversationId,
        "assistant",
        assistantMessage,
        { toolCalls, runId: this.context.runId }
      );
      await this.debugLogger.logConversationMessage("assistant", assistantMessage, { toolCalls, runId: this.context.runId });

      const toolResults = await toolService.executeTools(this.context, result.toolCalls);
      for (const toolResult of toolResults) {
        await this.conversationManager.addMessage(
          this.context.conversationId,
          "tool",
          toolResult.content,
          { toolCallId: toolResult.toolCallId, runId: this.context.runId }
        );
        await this.debugLogger.logConversationMessage("tool", toolResult.content, { toolCallId: toolResult.toolCallId, runId: this.context.runId });
        
        // Find the corresponding tool call for logging
        const toolCall = result.toolCalls.find(tc => tc.id === toolResult.toolCallId);
        if (toolCall) {
          await this.debugLogger.logToolCall(
            {
              id: toolCall.id,
              name: toolCall.name,
              arguments: typeof toolCall.arguments === "string" ? toolCall.arguments : JSON.stringify(toolCall.arguments),
            },
            toolResult,
            `brain_part_${this.brainPart.id}_iteration_${iterations}`
          );
        }
      }
    }

    // Max iterations reached
    console.log(`[BrainModule] ${this.brainPart.name} reached maximum iterations (${maxIterations})`);
    return {
      completed: false,
      result: `Brain module reached maximum iterations (${maxIterations})`,
      toolCallsMade,
    };
  }
}
