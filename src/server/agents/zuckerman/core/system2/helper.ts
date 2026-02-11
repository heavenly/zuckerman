import type { ExecutionHistoryEntry } from "./types.js";

export function extractJSON(content: string): string {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || trimmed.match(/(\{[\s\S]*\})/);
  return jsonMatch ? jsonMatch[1].trim() : trimmed;
}

export function formatHistoryText(executionHistory: ExecutionHistoryEntry[]): string {
  if (executionHistory.length === 0) return "Last Brain Part Execution: (none yet)";
  const last = executionHistory[executionHistory.length - 1];
  const result = last.result.length > 300 ? `${last.result.substring(0, 300)}...` : last.result;
  return `Last Brain Part Execution:\n${last.brainPartName} (${last.brainPartId})\nGoal: ${last.goal}\nCompleted: ${last.completed}\nResult: ${result}\nTool calls: ${last.toolCallsMade}`;
}

export function formatWorkingMemoryText(memories: string[]): string {
  return memories.length > 0
    ? `Working Memory:\n${memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : "Working Memory: (empty)";
}
