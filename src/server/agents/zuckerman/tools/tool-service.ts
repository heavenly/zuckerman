import type { ToolExecutionContext } from "./terminal/index.js";
import { activityRecorder } from "@server/world/activity/index.js";
import type { RunContext } from "../core/awareness/context.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string | Record<string, unknown>;
};

/**
 * Stateless tool execution service
 * Only executes tools - does NOT orchestrate LLM calls
 */
export class ToolService {
  /**
   * Execute multiple tool calls and return formatted results for LLM
   */
  async executeTools(
    context: RunContext,
    toolCalls: ToolCall[]
  ): Promise<Array<{ toolCallId: string; role: "tool"; content: string }>> {
    const toolCallResults: Array<{ toolCallId: string; role: "tool"; content: string }> = [];

    for (const toolCall of toolCalls) {
      // Try to get tool with repair (fixes case mismatches)
      const toolResult = context.toolRegistry.getWithRepair(toolCall.name);

      if (!toolResult) {
        // Tool not found - provide helpful error with suggestions
        const suggestions = context.toolRegistry.findSimilar(toolCall.name, 3);
        const suggestionText = suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(", ")}?`
          : "";

        toolCallResults.push({
          toolCallId: toolCall.id,
          role: "tool" as const,
          content: `Error: Tool "${toolCall.name}" not found.${suggestionText} Available tools: ${context.toolRegistry.list().map(t => t.definition.name).join(", ")}`,
        });
        continue;
      }

      const { tool, repaired, originalName } = toolResult;

      // Log repair if it happened
      if (repaired && originalName !== tool.definition.name) {
        console.log(`[ToolRepair] Fixed tool name: "${originalName}" -> "${tool.definition.name}"`);
      }

      try {
        // Parse arguments
        const args = typeof toolCall.arguments === "string"
          ? JSON.parse(toolCall.arguments)
          : toolCall.arguments;

        // Emit tool start event
        await context.streamEmitter.emitToolCall(tool.definition.name, args);

        // Record tool call
        await activityRecorder.recordToolCall(
          context.agentId,
          context.conversationId,
          context.runId,
          tool.definition.name,
          args,
        );

        // Create execution context for tool
        const executionContext: ToolExecutionContext = {
          conversationId: context.conversationId,
          homedir: context.homedir,
          stream: context.streamEmitter.createToolStream(),
        };

        // Execute tool
        const result = await tool.handler(args, context.securityContext, executionContext);

        // Emit tool end event
        await context.streamEmitter.emitToolResult(tool.definition.name, result);

        // Record tool result
        await activityRecorder.recordToolResult(
          context.agentId,
          context.conversationId,
          context.runId,
          tool.definition.name,
          result,
        );

        // Convert result to string for LLM
        const resultContent = this.formatResultForLLM(result);

        toolCallResults.push({
          toolCallId: toolCall.id,
          role: "tool" as const,
          content: resultContent,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Record tool error
        await activityRecorder.recordToolError(
          context.agentId,
          context.conversationId,
          context.runId,
          toolCall.name,
          errorMsg,
        );

        toolCallResults.push({
          toolCallId: toolCall.id,
          role: "tool" as const,
          content: `Error executing tool: ${errorMsg}`,
        });
      }
    }

    return toolCallResults;
  }

  /**
   * Format tool result for LLM consumption
   */
  private formatResultForLLM(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }
    
    if (!result || typeof result !== "object" || !("success" in result)) {
      return JSON.stringify(result);
    }
    
    const toolResult = result as { success?: boolean; result?: unknown; error?: string };
    
    if (toolResult.success && toolResult.result) {
      if (typeof toolResult.result === "object" && "content" in toolResult.result) {
        return String((toolResult.result as { content: unknown }).content);
      }
      return JSON.stringify(toolResult.result);
    }
    
    return toolResult.error || JSON.stringify(result);
  }
}
