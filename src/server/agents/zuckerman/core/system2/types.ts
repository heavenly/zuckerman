export interface StateUpdates {
  memories?: string[];
}

export interface WorkingMemory {
  memories: string[];
}

export interface BrainPart {
  id: string;
  name: string;
  maxIterations?: number;
  toolsAllowed?: boolean;
  getPrompt: (goal: string, workingMemory: string[], historyText: string) => string;
}

export interface BrainGoal {
  id: string;
  description: string;
  brainPartId: string;
}

export interface ExecutionHistoryEntry {
  brainPartId: string;
  brainPartName: string;
  goal: string;
  completed: boolean;
  result: string;
  toolCallsMade: number;
}
