/**
 * Sustained Attention - Focus Tracker
 * Maintains focus state over time
 */

import type { FocusState, OrientingAnalysis, AlertingAnalysis } from "../types.js";

/**
 * Manages focus state per agent
 */
export class FocusTracker {
  private focusStates: Map<string, FocusState> = new Map();

  /**
   * Get current focus state for agent
   */
  getFocus(agentId: string): FocusState | null {
    return this.focusStates.get(agentId) || null;
  }

  /**
   * Update focus state based on orienting and alerting analysis
   */
  updateFocus(
    agentId: string,
    orienting: OrientingAnalysis,
    alerting: AlertingAnalysis,
    conversationId?: string
  ): FocusState {
    const current = this.getFocus(agentId);

    // Determine if focus shifted
    const focusShifted = !orienting.isContinuation ||
      (current && current.currentTopic !== orienting.topic);

    let turnCount = 1;
    if (focusShifted) {
      // New focus - reset turn count
      turnCount = 1;
    } else if (current) {
      // Continuation - increment turn count
      turnCount = current.turnCount + 1;
    }

    const newState: FocusState = {
      agentId,
      currentTopic: orienting.topic,
      currentTask: orienting.task,
      urgency: alerting.urgency,
      focusLevel: orienting.focusLevel,
      lastUpdated: Date.now(),
      turnCount,
      lastConversationId: conversationId,
    };

    this.focusStates.set(agentId, newState);
    return newState;
  }

  /**
   * Clear focus for agent
   */
  clearFocus(agentId: string): void {
    this.focusStates.delete(agentId);
  }

  /**
   * Get all active focuses (for debugging)
   */
  getAllFocuses(): FocusState[] {
    return Array.from(this.focusStates.values());
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
    const current = this.getFocus(agentId);
    if (!current) {
      return null; // No focus to update
    }

    // Determine if task change represents topic shift
    const taskChanged = current.currentTask !== taskTitle;
    const topicShifted = taskChanged && 
      taskTitle.toLowerCase() !== current.currentTopic.toLowerCase() &&
      !taskTitle.toLowerCase().includes(current.currentTopic.toLowerCase());

    let turnCount = current.turnCount;
    if (topicShifted) {
      turnCount = 1; // New topic - reset
    } else if (taskChanged) {
      turnCount += 1; // Same topic, new task - increment
    }
    // If same task, keep turn count

    const updated: FocusState = {
      ...current,
      currentTask: taskTitle,
      urgency: urgency || current.urgency,
      lastUpdated: Date.now(),
      turnCount,
      lastConversationId: conversationId || current.lastConversationId,
    };

    this.focusStates.set(agentId, updated);
    return updated;
  }

  /**
   * Clear task from focus (when task completes)
   * Keeps topic but removes task reference
   */
  clearTaskFocus(agentId: string): FocusState | null {
    const current = this.getFocus(agentId);
    if (!current) {
      return null;
    }

    const updated: FocusState = {
      ...current,
      currentTask: undefined,
      lastUpdated: Date.now(),
    };

    this.focusStates.set(agentId, updated);
    return updated;
  }
}
