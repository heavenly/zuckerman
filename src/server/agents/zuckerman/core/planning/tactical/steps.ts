/**
 * Tactical Planning - Step sequences
 * Manages step-by-step task execution
 */

import type { Task } from "../types.js";
import type { LLMMessage } from "@server/world/providers/llm/types.js";
import { LLMManager } from "@server/world/providers/llm/index.js";
import type { UrgencyLevel } from "../../attention/types.js";
import type { FocusState } from "../../attention/types.js";

/**
 * Task step
 */
export interface TaskStep {
  id: string;
  title: string;
  description?: string;
  order: number;
  completed: boolean;
  requiresConfirmation: boolean; // LLM decides if step needs user confirmation
  confirmationReason?: string; // Why confirmation is needed
  result?: unknown;
  error?: string;
}

/**
 * Step sequence manager
 */
export class StepSequenceManager {
  /**
   * Decompose task into steps using LLM
   */
  async decomposeWithLLM(
    message: string,
    urgency: UrgencyLevel,
    focus: FocusState | null
  ): Promise<TaskStep[]> {
    const llmManager = LLMManager.getInstance();
    const model = await llmManager.fastCheap();

    const systemPrompt = `You are the tactical planning system. Break down the user's request into clear, actionable steps.

Analyze the task and create a step-by-step plan. For each step, determine if it requires user confirmation before execution.

Steps that require confirmation:
- File deletion or modification
- System configuration changes
- Network operations
- Potentially destructive actions
- Sensitive operations

Return JSON array of steps:
[
  {
    "title": "step title",
    "description": "what this step does",
    "order": 0,
    "requiresConfirmation": true/false,
    "confirmationReason": "why confirmation is needed (if requiresConfirmation is true)"
  }
]

Return ONLY valid JSON array, no other text.`;

    const context = focus
      ? `Current focus: ${focus.currentTopic}${focus.currentTask ? ` (task: ${focus.currentTask})` : ""}\nUrgency: ${urgency}\n\nTask: ${message}`
      : `Urgency: ${urgency}\n\nTask: ${message}`;

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ];

    try {
      const response = await model.call({
        messages,
        temperature: 0.3,
        maxTokens: 500,
      });

      const content = response.content.trim();
      const jsonMatch = content.match(/```(?:json)?\s*(\[.*?\])/s);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        throw new Error("Invalid response format");
      }

      // Convert to TaskStep format
      const steps: TaskStep[] = parsed.map((step: any, index: number) => ({
        id: `step-${Date.now()}-${index}`,
        title: step.title || `Step ${index + 1}`,
        description: step.description,
        order: step.order ?? index,
        completed: false,
        requiresConfirmation: Boolean(step.requiresConfirmation),
        confirmationReason: step.confirmationReason,
      }));

      return steps.length > 0 ? steps : this.createFallbackStep(message);
    } catch (error) {
      console.warn(`[Tactical] LLM decomposition failed:`, error);
      return this.createFallbackStep(message);
    }
  }

  /**
   * Create fallback step if LLM fails
   */
  private createFallbackStep(message: string): TaskStep[] {
    return [
      {
        id: `step-${Date.now()}-0`,
        title: message,
        order: 0,
        completed: false,
        requiresConfirmation: false,
      },
    ];
  }

  /**
   * Create steps from task description (fallback)
   */
  createSteps(task: Task): TaskStep[] {
    const steps: TaskStep[] = [];

    if (task.description) {
      const stepTexts = task.description.split(/[→\n\-]/).filter((s) => s.trim());
      stepTexts.forEach((text, index) => {
        steps.push({
          id: `${task.id}-step-${index}`,
          title: text.trim(),
          order: index,
          completed: false,
          requiresConfirmation: false,
        });
      });
    }

    if (steps.length === 0) {
      steps.push({
        id: `${task.id}-step-0`,
        title: task.title,
        order: 0,
        completed: false,
        requiresConfirmation: false,
      });
    }

    return steps;
  }

  /**
   * Get current step
   */
  getCurrentStep(steps: TaskStep[]): TaskStep | null {
    return steps.find((s) => !s.completed) || null;
  }

  /**
   * Complete step
   */
  completeStep(steps: TaskStep[], stepId: string, result?: unknown): boolean {
    const step = steps.find((s) => s.id === stepId);
    if (!step) {
      return false;
    }

    step.completed = true;
    step.result = result;
    return true;
  }

  /**
   * Calculate progress from steps
   */
  calculateProgress(steps: TaskStep[]): number {
    if (steps.length === 0) {
      return 0;
    }

    const completed = steps.filter((s) => s.completed).length;
    return Math.round((completed / steps.length) * 100);
  }

  /**
   * Check if all steps completed
   */
  areAllStepsCompleted(steps: TaskStep[]): boolean {
    return steps.every((s) => s.completed);
  }
}
