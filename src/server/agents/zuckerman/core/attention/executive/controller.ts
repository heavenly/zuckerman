/**
 * Executive Attention - Controller
 * Coordinates all attention subsystems
 */

import type { AttentionState, AttentionConfig, FocusState } from "../types.js";
import { detectUrgency } from "../alerting/index.js";
import { analyzeOrienting } from "../orienting/index.js";
import { FocusTracker } from "../sustained/index.js";
import { createFilterCriteria } from "../selective/index.js";
import { LLMManager } from "@server/world/providers/llm/index.js";
import type { LLMProvider } from "@server/world/providers/llm/types.js";

/**
 * Executive Attention Controller
 * Coordinates all attention subsystems
 */
export class ExecutiveController {
  private config: Required<AttentionConfig>;
  private focusTracker: FocusTracker;
  private llmManager: LLMManager;

  constructor(config: AttentionConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      focusPersistence: config.focusPersistence ?? true,
      defaultUrgency: config.defaultUrgency ?? "medium",
    };
    this.focusTracker = new FocusTracker();
    this.llmManager = LLMManager.getInstance();
  }

  /**
   * Process message through all attention subsystems
   */
  async processMessage(
    message: string,
    agentId: string,
    conversationId?: string
  ): Promise<AttentionState | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      // Step 1: Alerting - Detect urgency
      const alerting = await detectUrgency(message);

      // Step 2: Get previous focus for orienting
      const previousFocus = this.config.focusPersistence
        ? this.focusTracker.getFocus(agentId)
        : undefined;

      // Step 3: Orienting - Determine what to attend to
      const orienting = await analyzeOrienting(
        message,
        previousFocus
          ? {
              topic: previousFocus.currentTopic,
              task: previousFocus.currentTask,
            }
          : undefined
      );

      // Step 4: Sustained - Update focus state
      let focus: FocusState | null = null;
      if (this.config.focusPersistence) {
        focus = this.focusTracker.updateFocus(
          agentId,
          orienting,
          alerting,
          conversationId
        );
      }

      // Step 5: Create attention state
      const state: AttentionState = {
        agentId,
        orienting,
        alerting,
        focus,
        timestamp: Date.now(),
      };

      return state;
    } catch (error) {
      console.warn(`[Executive] Attention processing failed:`, error);
      return null;
    }
  }

  /**
   * Get current focus state
   */
  getCurrentFocus(agentId: string): FocusState | null {
    return this.focusTracker.getFocus(agentId);
  }

  /**
   * Update focus task from planning system
   * Preserves topic continuity while updating active task
   */
  updateTaskFocus(
    agentId: string,
    taskTitle: string,
    urgency?: FocusState["urgency"],
    conversationId?: string
  ): FocusState | null {
    if (!this.config.enabled || !this.config.focusPersistence) {
      return null;
    }
    return this.focusTracker.updateTaskFocus(agentId, taskTitle, urgency, conversationId);
  }

  /**
   * Clear task focus (when task completes)
   * Keeps topic but removes task reference
   */
  clearTaskFocus(agentId: string): FocusState | null {
    if (!this.config.enabled || !this.config.focusPersistence) {
      return null;
    }
    return this.focusTracker.clearTaskFocus(agentId);
  }

  /**
   * Get filter criteria for selective attention
   */
  getFilterCriteria(agentId: string) {
    const focus = this.focusTracker.getFocus(agentId);
    return createFilterCriteria(focus);
  }

  /**
   * Clear focus for agent
   */
  clearFocus(agentId: string): void {
    this.focusTracker.clearFocus(agentId);
  }
}
