import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

interface DebugLogEntry {
  timestamp: string;
  type: string;
  data: unknown;
}

export class System2DebugLogger {
  private logFilePath: string;
  private entries: DebugLogEntry[] = [];
  private runId: string;

  constructor(runId: string, homedir: string) {
    this.runId = runId;
    const debugDir = join(homedir, "debug");
    this.logFilePath = join(debugDir, `system2-${runId}.log`);
  }

  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.logFilePath);
      await mkdir(dir, { recursive: true });
      
      // Write initial header
      await writeFile(
        this.logFilePath,
        `=== System2 Debug Log ===\nRun ID: ${this.runId}\nStarted: ${new Date().toISOString()}\n\n`,
        "utf-8"
      );
    } catch (error) {
      console.error(`[System2Debug] Failed to initialize log file:`, error);
    }
  }

  private async writeEntry(type: string, data: unknown): Promise<void> {
    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      data,
    };

    this.entries.push(entry);

    try {
      const logLine = `[${entry.timestamp}] [${type}]\n${JSON.stringify(data, null, 2)}\n\n`;
      await appendFile(this.logFilePath, logLine, "utf-8");
    } catch (error) {
      console.error(`[System2Debug] Failed to write log entry:`, error);
    }
  }

  async logSystemStart(message: string, relevantMemories: string, context?: {
    agentId?: string;
    conversationId?: string;
    systemPrompt?: string;
    availableTools?: unknown[];
    temperature?: number;
  }): Promise<void> {
    await this.writeEntry("SYSTEM_START", {
      message,
      relevantMemories,
      context,
    });
  }

  async logCycleStart(cycle: number): Promise<void> {
    await this.writeEntry("CYCLE_START", { cycle });
  }

  async logDecision(decision: {
    brainPartId?: string;
    goal?: string;
    shouldStop: boolean;
    reason?: string;
  }): Promise<void> {
    await this.writeEntry("DECISION", decision);
  }

  async logMemoryUpdate(memories: string[]): Promise<void> {
    await this.writeEntry("MEMORY_UPDATE", { memories });
  }

  async logBrainPartActivation(brainPartId: string, brainPartName: string, goal: string): Promise<void> {
    await this.writeEntry("BRAIN_PART_ACTIVATION", {
      brainPartId,
      brainPartName,
      goal,
    });
  }

  async logBrainPartResult(
    brainPartId: string,
    brainPartName: string,
    result: {
      completed: boolean;
      result: string;
      toolCallsMade: number;
    }
  ): Promise<void> {
    await this.writeEntry("BRAIN_PART_RESULT", {
      brainPartId,
      brainPartName,
      ...result,
    });
  }

  async logExecutionHistory(history: Array<{
    brainPartId: string;
    brainPartName: string;
    goal: string;
    completed: boolean;
    result: string;
    toolCallsMade: number;
  }>): Promise<void> {
    await this.writeEntry("EXECUTION_HISTORY", { history });
  }

  async logWorkingMemory(memories: string[]): Promise<void> {
    await this.writeEntry("WORKING_MEMORY", { memories });
  }

  async logSystemEnd(response: string, cycles: number): Promise<void> {
    await this.writeEntry("SYSTEM_END", {
      response,
      cycles,
      totalEntries: this.entries.length,
    });
  }

  async logError(error: Error | unknown, context?: string): Promise<void> {
    await this.writeEntry("ERROR", {
      context,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
    });
  }

  async logLLMCall(context: string, messages: Array<{ role: string; content: string; toolCalls?: unknown }>, response: { content: string; toolCalls?: unknown }, temperature?: number, availableTools?: unknown[]): Promise<void> {
    await this.writeEntry("LLM_CALL", {
      context,
      request: {
        messages,
        temperature,
        availableTools: availableTools?.map(t => ({
          name: (t as { name?: string }).name,
          description: (t as { description?: string }).description,
        })),
      },
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
      },
    });
  }

  async logToolCall(toolCall: { id: string; name: string; arguments: string }, result: { toolCallId: string; content: string }, context?: string): Promise<void> {
    await this.writeEntry("TOOL_CALL", {
      context,
      toolCall: {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
      result: {
        toolCallId: result.toolCallId,
        content: result.content,
      },
    });
  }

  async logConversationMessage(role: string, content: string, metadata?: { toolCalls?: unknown; toolCallId?: string; runId?: string }): Promise<void> {
    await this.writeEntry("CONVERSATION_MESSAGE", {
      role,
      content,
      metadata,
    });
  }

  async logBrainPartIteration(brainPartId: string, brainPartName: string, iteration: number, maxIterations: number, workingMemory: string[]): Promise<void> {
    await this.writeEntry("BRAIN_PART_ITERATION", {
      brainPartId,
      brainPartName,
      iteration,
      maxIterations,
      workingMemory,
    });
  }

  async logBrainPartPrompt(brainPartId: string, brainPartName: string, prompt: string): Promise<void> {
    await this.writeEntry("BRAIN_PART_PROMPT", {
      brainPartId,
      brainPartName,
      prompt,
    });
  }

  async logDecisionPrompt(prompt: string, workingMemory: string[], executionHistory: unknown[]): Promise<void> {
    await this.writeEntry("DECISION_PROMPT", {
      prompt,
      workingMemory,
      executionHistory,
    });
  }

  async logMemoryPrompt(prompt: string, currentMemory: string[]): Promise<void> {
    await this.writeEntry("MEMORY_PROMPT", {
      prompt,
      currentMemory,
    });
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }
}
