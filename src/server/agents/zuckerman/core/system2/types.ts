import { ConversationState } from "@server/agents/zuckerman/conversations/types.js";

// ============================================================================
// Core Types
// ============================================================================

export interface Goal {
  id: string;
  description: string;
  status: GoalStatus;
  subGoals?: Goal[];
}

export type GoalStatus = "pending" | "active" | "completed" | "failed";

// ============================================================================
// Module System
// ============================================================================

export interface ModuleInput {
  userMessage: string;
  state: string;
}

export interface Proposal {
  module: string;
  confidence: number; // 0.0–1.0
  priority: number;   // 0-10
  payload: unknown;
  reasoning: string;
}

// ============================================================================
// Action System
// ============================================================================

export enum Action {
  Respond = "respond",
  Decompose = "decompose",
  CallTool = "call_tool",
  Termination = "termination",
}

export interface ActionPayload {
  respond?: { message: string };
  decompose?: { goals: Goal[] };
  call_tool?: unknown;
  termination?: { message?: string };
}

// ============================================================================
// Decision System
// ============================================================================

export interface Decision {
  selectedModule: string;
  action: Action | Action[];
  payload: unknown | unknown[];
  stateUpdates: StateUpdates;
  reasoning: string;
}

export interface StateUpdates {
  goals?: Goal[];
  semanticMemory?: string[];
  episodicMemory?: string[];
  proceduralMemory?: string[];
  prospectiveMemory?: string[];
}

// ============================================================================
// Working Memory
// ============================================================================

export interface WorkingMemory {
  goals: Goal[];
  semanticMemory: string[];
  episodicMemory: string[];
  proceduralMemory: string[];
  prospectiveMemory: string[];
  conversation: ConversationState;
}

export interface StateSummary {
  goals: Array<{ id: string; description: string; status: GoalStatus }>;
  memoryCounts: {
    semantic: number;
    episodic: number;
    procedural: number;
    prospective: number;
  };
  messages: Array<{
    role: string;
    content: string;
    timestamp?: number;
    toolCalls?: unknown;
    toolCallId?: string;
  }>;
}
