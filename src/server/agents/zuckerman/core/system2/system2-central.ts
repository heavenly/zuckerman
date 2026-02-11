import type { RunContext } from "@server/world/providers/llm/context.js";
import { LLMService } from "@server/world/providers/llm/llm-service.js";
import { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import { BrainModule } from "./brain-module.js";
import type { BrainGoal, ExecutionHistoryEntry } from "./types.js";
import { BRAIN_PARTS, getBrainPart } from "./brain-parts.js";
import { WorkingMemoryManager } from "./working-memory.js";
import { System2DebugLogger } from "./debug.js";
import { extractJSON, formatHistoryText, formatWorkingMemoryText } from "./helper.js";
import { randomUUID } from "node:crypto";

export class System2 {
  constructor(
    private conversationManager: ConversationManager,
    private context: RunContext
  ) {}

  async run(): Promise<{ runId: string; response: string; tokensUsed?: number }> {
    const llmService = new LLMService(this.context.llmModel, this.context.streamEmitter, this.context.runId);
    const maxCycles = 100; // Safety limit for infinite loop
    let cycles = 0;

    const executionHistory: ExecutionHistoryEntry[] = [];
    const debugLogger = new System2DebugLogger(this.context.runId, this.context.homedir);
    await debugLogger.initialize();
    await debugLogger.logSystemStart(
      this.context.message,
      this.context.relevantMemoriesText || "",
      {
        agentId: this.context.agentId,
        conversationId: this.context.conversationId,
        systemPrompt: this.context.systemPrompt,
        availableTools: this.context.availableTools.map(t => ({
          name: t.function.name,
          description: t.function.description,
        })),
        temperature: this.context.temperature,
      }
    );

    const workingMemory = WorkingMemoryManager.initialize(this.context.relevantMemoriesText);
    const workingMemoryManager = new WorkingMemoryManager(workingMemory);
    workingMemoryManager.update({
      memories: [`I need to: ${this.context.message}`, ...workingMemory.memories],
    });

    await debugLogger.logWorkingMemory(workingMemoryManager.getState().memories);

    while (cycles < maxCycles) {
      cycles++;
      await debugLogger.logCycleStart(cycles);

      const decision = await this.coordinateNext(llmService, workingMemoryManager, executionHistory, debugLogger);
      await debugLogger.logDecision(decision);
            
      if (decision.shouldStop) {
        const finalResponse = decision.reason || "Task completed";
        await this.conversationManager.addMessage(
          this.context.conversationId,
          "assistant",
          finalResponse,
          { runId: this.context.runId }
        );
        await debugLogger.logConversationMessage("assistant", finalResponse, { runId: this.context.runId });
        await this.context.streamEmitter.emitLifecycleEnd(this.context.runId, 0, finalResponse);
        await debugLogger.logSystemEnd(finalResponse, cycles);
        
        return {
          runId: this.context.runId,
          response: finalResponse,
        };
      }

      const brainPart = getBrainPart(decision.brainPartId);
      if (!brainPart) {
        const error = new Error(`Unknown brain part: ${decision.brainPartId}`);
        await debugLogger.logError(error, "brain_part_selection");
        // Don't silently continue - this could cause infinite loops
        // Instead, add error to execution history and let coordinator decide next step
        executionHistory.push({
          brainPartId: decision.brainPartId,
          brainPartName: "unknown",
          goal: decision.goal,
          completed: false,
          result: `Error: Unknown brain part "${decision.brainPartId}"`,
          toolCallsMade: 0,
        });
        await debugLogger.logExecutionHistory(executionHistory);
        continue;
      }

      const goal: BrainGoal = {
        id: randomUUID(),
        description: decision.goal,
        brainPartId: decision.brainPartId,
      };

      await debugLogger.logBrainPartActivation(brainPart.id, brainPart.name, goal.description);

      const brainModule = new BrainModule(
        this.conversationManager,
        this.context,
        brainPart,
        goal,
        workingMemoryManager,
        formatHistoryText(executionHistory),
        debugLogger
      );

      let brainResult;
      try {
        brainResult = await brainModule.run();
      } catch (error) {
        await debugLogger.logError(error, `brain_part_execution_${brainPart.id}`);
        throw error;
      }

      await debugLogger.logBrainPartResult(brainPart.id, brainPart.name, {
        completed: brainResult.completed,
        result: brainResult.result,
        toolCallsMade: brainResult.toolCallsMade,
      });

      await workingMemoryManager.remember(llmService, this.context.systemPrompt, brainResult, brainPart.id, brainPart.name, debugLogger);

      executionHistory.push({
        brainPartId: brainPart.id,
        brainPartName: brainPart.name,
        goal: goal.description,
        completed: brainResult.completed,
        result: brainResult.result,
        toolCallsMade: brainResult.toolCallsMade,
      });

      await debugLogger.logExecutionHistory(executionHistory);
    }

    const timeoutResponse = "System2 reached maximum cycles. Task may be incomplete.";
    await this.conversationManager.addMessage(
      this.context.conversationId,
      "assistant",
      timeoutResponse,
      { runId: this.context.runId }
    );
    await debugLogger.logConversationMessage("assistant", timeoutResponse, { runId: this.context.runId });
    await this.context.streamEmitter.emitLifecycleEnd(this.context.runId, 0, timeoutResponse);
    await debugLogger.logSystemEnd(timeoutResponse, cycles);

    return {
      runId: this.context.runId,
      response: timeoutResponse,
    };
  }

  private async coordinateNext(
    llmService: LLMService,
    workingMemoryManager: WorkingMemoryManager,
    executionHistory: ExecutionHistoryEntry[],
    debugLogger: System2DebugLogger
  ): Promise<{
    brainPartId: string;
    goal: string;
    shouldStop: boolean;
    reason: string;
  }> {
    const workingMemory = workingMemoryManager.getState();
    const brainPartsList = BRAIN_PARTS.map(p => `- ${p.id}: ${p.name}`).join("\n");

    const decisionPrompt = `You ARE Zuckerman. You are thinking through your Self - your central decision maker coordinating your brain modules to accomplish what you need to do.

Available brain parts:
${brainPartsList}

${formatWorkingMemoryText(workingMemory.memories)}

${formatHistoryText(executionHistory)}

Decide for yourself:
1. Should you stop? (if you have fully accomplished what you need to do)
2. If not, which brain part should you use next and what should you focus on?

Before research it's good to predict potential difficulties and obstacles and identify better paths to avoid them.

Guidance:
- prediction: predict potential difficulties and obstacles before they occur and identify better paths to avoid them
- research: find solutions/information from online sources
- planning: break down complex goals into steps
- execution: perform clear tasks
- reflection: analyze past actions
- criticism: evaluate work/plans
- creativity: generate novel ideas
- attention: focus on important details
- interaction: communicate with users/systems
- error-handling: handle errors/obstacles

Respond in JSON:
{
  "action": "stop" | "continue",
  "reason": string,
  "brainPartId": string,
  "goal": string
}

If action is "stop", provide reason. If "continue", provide brainPartId and goal.`;

    await debugLogger.logDecisionPrompt(decisionPrompt, workingMemory.memories, executionHistory);

    const messages = [
      { role: "system" as const, content: this.context.systemPrompt },
      { role: "user" as const, content: decisionPrompt },
    ];
    const result = await llmService.call({
      messages,
      temperature: 0.3,
      availableTools: [],
      responseFormat: "json_object",
    });

    await debugLogger.logLLMCall("coordinateNext", messages, result, 0.3, []);

    try {
      const jsonContent = extractJSON(result.content);
      const decision = JSON.parse(jsonContent);
      const shouldStop = decision.action === "stop";
      return {
        brainPartId: shouldStop ? "" : (decision.brainPartId || ""),
        goal: shouldStop ? "" : (decision.goal || ""),
        shouldStop,
        reason: decision.reason,
      };
    } catch (error) {
      await debugLogger.logError(new Error(`Failed to parse JSON: ${error}`), "coordinateNext");
      throw new Error(`[System2] Failed to parse decision response: ${error}. Response: ${result.content.substring(0, 200)}`);
    }
  }

}
