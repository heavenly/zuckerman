import type { StreamCallback, StreamEvent } from "@server/world/runtime/agents/types.js";
import { activityRecorder } from "@server/agents/zuckerman/activity/index.js";

export class StreamEventEmitter {
  constructor(
    private stream?: StreamCallback,
    private agentId?: string,
    private conversationId?: string,
  ) {}

  async emitLifecycleStart(runId: string, message?: string): Promise<void> {
    if (!this.stream) return;
    await this.stream({
      type: "lifecycle",
      data: {
        phase: "start",
        runId,
      },
    });
    if (this.agentId && this.conversationId && message) {
      activityRecorder.recordAgentRunStart(this.agentId, this.conversationId, runId, message).catch(err => console.warn(`[StreamEventEmitter] Failed to record run start:`, err));
    }
  }

  async emitLifecycleEnd(runId: string, tokensUsed?: number, response?: string, toolsUsed?: string[]): Promise<void> {
    if (!this.stream) return;
    await this.stream({
      type: "lifecycle",
      data: {
        phase: "end",
        runId,
        tokensUsed,
      },
    });
    if (this.agentId && this.conversationId && response !== undefined) {
      activityRecorder.recordAgentRunComplete(this.agentId, this.conversationId, runId, response, tokensUsed, toolsUsed).catch(err => console.warn(`[StreamEventEmitter] Failed to record run complete:`, err));
    }
  }

  async emitLifecycleError(runId: string, error: string): Promise<void> {
    if (!this.stream) return;
    await this.stream({
      type: "lifecycle",
      data: {
        phase: "error",
        error,
        runId,
      },
    });
    if (this.agentId && this.conversationId) {
      activityRecorder.recordAgentRunError(this.agentId, this.conversationId, runId, error).catch(err => console.warn(`[StreamEventEmitter] Failed to record run error:`, err));
    }
  }

  async emitToken(runId: string, token: string): Promise<void> {
    if (!this.stream) return;
    await this.stream({
      type: "token",
      data: {
        token,
        runId,
      },
    });
  }


  async emitToolCall(tool: string, toolArgs: Record<string, unknown>): Promise<void> {
    if (!this.stream) return;
    await this.stream({
      type: "tool.call",
      data: {
        tool,
        toolArgs,
      },
    });
  }

  async emitToolResult(tool: string, toolResult: unknown): Promise<void> {
    if (!this.stream) return;
    await this.stream({
      type: "tool.result",
      data: {
        tool,
        toolResult,
      },
    });
  }

  createToolStream(): ((event: { type: string; data: { tool: string; toolArgs?: Record<string, unknown>; toolResult?: unknown } }) => void) | undefined {
    if (!this.stream) return undefined;
    return (event) => {
      this.stream!({
        type: event.type === "tool.call" ? "tool.call" : "tool.result",
        data: {
          tool: event.data.tool,
          toolArgs: event.data.toolArgs,
          toolResult: event.data.toolResult,
        },
      });
    };
  }
}
