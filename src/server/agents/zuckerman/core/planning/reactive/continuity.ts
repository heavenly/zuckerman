/**
 * Reactive Planning - Focus Continuity Analyzer
 * LLM-based assessment of focus continuity for task switching decisions
 */

import type { FocusState } from "../../attention/types.js";
import type { Task } from "../types.js";
import type { LLMMessage } from "@server/world/providers/llm/types.js";
import { LLMManager } from "@server/world/providers/llm/index.js";

/**
 * Continuity assessment result
 */
export interface ContinuityAssessment {
  continuityStrength: number; // 0-1
  shouldSwitch: boolean;
  reasoning: string;
}

/**
 * Focus Continuity Analyzer
 * Uses LLM to assess focus continuity and make task switching decisions
 */
export class FocusContinuityAnalyzer {
  private llmManager: LLMManager;

  constructor() {
    this.llmManager = LLMManager.getInstance();
  }

  /**
   * Assess focus continuity and determine if task switch should occur
   */
  async assessContinuity(
    currentFocus: FocusState | null,
    currentTask: Task | null,
    newTask: Task
  ): Promise<ContinuityAssessment> {
    // If no current task, can switch
    if (!currentTask) {
      return {
        continuityStrength: 0,
        shouldSwitch: true,
        reasoning: "No current task, can start new task",
      };
    }

    // Same task - don't switch
    if (currentTask.id === newTask.id) {
      return {
        continuityStrength: 1.0,
        shouldSwitch: false,
        reasoning: "Same task, continue execution",
      };
    }

    // If no focus state, use simple urgency-based fallback
    if (!currentFocus) {
      return {
        continuityStrength: 0.5,
        shouldSwitch: newTask.urgency === "critical",
        reasoning: "No focus state available, using urgency-based decision",
      };
    }

    // Use LLM to assess continuity
    try {
      const model = await this.llmManager.fast();
      const timeAgo = Math.round((Date.now() - currentFocus.lastUpdated) / 1000);
      const timeAgoText = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.round(timeAgo / 60)}m ago`;

      const systemPrompt = `You are assessing focus continuity for task switching decisions.

Analyze the situation and determine:
1. How strong is the focus continuity? (0.0-1.0)
   - Consider: topic similarity, task relevance, turn count, recency
   - Higher = stronger continuity (should resist switching)
   
2. Should we switch tasks? (true/false)
   - Consider: continuity strength, task urgency, topic relevance, interruption cost
   - Critical tasks can override continuity
   - Strong continuity (>0.7) should resist switching unless critical or highly relevant

3. Provide clear reasoning for your decision

Return ONLY valid JSON:
{
  "continuityStrength": 0.0-1.0,
  "shouldSwitch": true/false,
  "reasoning": "explanation of your decision"
}`;

      const context = `Current Focus:
- Topic: ${currentFocus.currentTopic}
- Task: ${currentFocus.currentTask || "none"}
- Turn Count: ${currentFocus.turnCount}
- Urgency: ${currentFocus.urgency}
- Last Updated: ${timeAgoText}
- Focus Level: ${currentFocus.focusLevel}

Current Task:
- Title: ${currentTask.title}
- Urgency: ${currentTask.urgency}
- Progress: ${currentTask.progress || 0}%
- Type: ${currentTask.type}

New Task:
- Title: ${newTask.title}
- Urgency: ${newTask.urgency}
- Type: ${newTask.type}
- Description: ${newTask.description || "none"}`;

      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: context },
      ];

      const response = await model.call({
        messages,
        temperature: 0.3,
        maxTokens: 300,
      });

      const content = response.content.trim();
      const jsonMatch = content.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(jsonStr);

      return {
        continuityStrength: Math.max(0, Math.min(1, parsed.continuityStrength || 0.5)),
        shouldSwitch: Boolean(parsed.shouldSwitch),
        reasoning: parsed.reasoning || "LLM assessment completed",
      };
    } catch (error) {
      console.warn(`[Continuity] LLM assessment failed:`, error);
      // Fallback: use urgency-based decision
      return {
        continuityStrength: 0.5,
        shouldSwitch: newTask.urgency === "critical" || 
                     (currentTask.urgency !== "critical" && newTask.urgency === "high"),
        reasoning: "LLM assessment failed, using urgency-based fallback",
      };
    }
  }
}
