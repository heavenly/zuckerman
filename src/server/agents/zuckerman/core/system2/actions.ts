import type { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import type { LLMService } from "@server/world/providers/llm/llm-service.js";
import type { ToolService } from "../../tools/index.js";
import type { RunContext } from "@server/world/providers/llm/context.js";
import { Action, type Goal, type WorkingMemory } from "./types.js";

export interface ActionContext {
  conversationManager: ConversationManager;
  llmService: LLMService;
  toolService: ToolService;
  context: RunContext;
  workingMemory: WorkingMemory;
}

export interface ActionResult {
  shouldContinue: boolean;
}

export class ActionHandler {
  constructor(private actionContext: ActionContext) {}

  async execute(action: Action, payload: unknown): Promise<ActionResult> {
    switch (action) {
      case Action.Respond:
        return this.handleRespond(payload);
      case Action.Termination:
        return this.handleTermination(payload);
      case Action.Decompose:
        return this.handleDecompose(payload);
      case Action.CallTool:
        return this.handleCallTool(payload);
      default:
        console.warn(`[ActionHandler] Unknown action: ${action}`);
        return { shouldContinue: false };
    }
  }

  private async handleRespond(payload: unknown): Promise<ActionResult> {
    const message = this.extractMessage(payload);
    if (!message) {
      console.warn(`[ActionHandler] No message in respond payload`);
      return { shouldContinue: true };
    }

    console.log(`[ActionHandler] Sending response (${message.length} chars)`);
    await this.actionContext.conversationManager.addMessage(
      this.actionContext.context.conversationId,
      "assistant",
      message,
      { runId: this.actionContext.context.runId }
    );

    return { shouldContinue: true };
  }

  private async handleTermination(payload: unknown): Promise<ActionResult> {
    console.log(`[ActionHandler] Termination action - ending cycle`);
    
    const payloadObj = payload as { message?: string };
    if (payloadObj?.message) {
      await this.actionContext.conversationManager.addMessage(
        this.actionContext.context.conversationId,
        "assistant",
        payloadObj.message,
        { runId: this.actionContext.context.runId }
      );
    }

    return { shouldContinue: false };
  }

  private async handleDecompose(payload: unknown): Promise<ActionResult> {
    const payloadObj = payload as { goals?: Goal[]; subGoals?: Goal[] };
    const goals = payloadObj.goals || payloadObj.subGoals || [];

    console.log(`[ActionHandler] Decomposing into ${goals.length} goals`);
    
    for (const goal of goals) {
      if (goal.id && goal.description) {
        this.actionContext.workingMemory.goals.push({
          id: goal.id,
          description: goal.description,
          status: goal.status || "pending",
          subGoals: goal.subGoals,
        });
      }
    }

    console.log(`[ActionHandler] Working memory now has ${this.actionContext.workingMemory.goals.length} goals`);
    return { shouldContinue: true };
  }

  private async handleCallTool(payload: unknown): Promise<ActionResult> {
    console.log(`[ActionHandler] Calling LLM to execute tool`);
    
    const conversation = this.actionContext.conversationManager.getConversation(
      this.actionContext.context.conversationId
    );

    const result = await this.actionContext.llmService.call({
      messages: this.actionContext.llmService.buildMessages(
        this.actionContext.context,
        conversation
      ),
      temperature: this.actionContext.context.temperature,
      availableTools: this.actionContext.context.availableTools,
    });

    if (result.toolCalls?.length) {
      console.log(`[ActionHandler] LLM returned ${result.toolCalls.length} tool call(s)`);
      
      const toolCalls = result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
      }));

      await this.actionContext.conversationManager.addMessage(
        this.actionContext.context.conversationId,
        "assistant",
        "",
        { toolCalls, runId: this.actionContext.context.runId }
      );

      const toolResults = await this.actionContext.toolService.executeTools(
        this.actionContext.context,
        result.toolCalls
      );

      console.log(`[ActionHandler] Executed ${toolResults.length} tool(s) successfully`);
      
      for (const toolResult of toolResults) {
        await this.actionContext.conversationManager.addMessage(
          this.actionContext.context.conversationId,
          "tool",
          toolResult.content,
          { toolCallId: toolResult.toolCallId, runId: this.actionContext.context.runId }
        );
      }

      return { shouldContinue: true };
    } else {
      // No tool calls, treat as response
      console.log(`[ActionHandler] No tool calls, treating as response`);
      await this.actionContext.conversationManager.addMessage(
        this.actionContext.context.conversationId,
        "assistant",
        result.content,
        { runId: this.actionContext.context.runId }
      );
      return { shouldContinue: false };
    }
  }

  private extractMessage(payload: unknown): string | null {
    if (typeof payload === "string") return payload;
    if (typeof payload === "object" && payload !== null) {
      const obj = payload as Record<string, unknown>;
      return (obj.response || obj.message || JSON.stringify(payload)) as string;
    }
    return null;
  }
}
