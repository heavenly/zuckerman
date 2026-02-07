import type { ConversationState } from "@server/agents/zuckerman/conversations/types.js";
import type { WorkingMemory, StateSummary, StateUpdates, Goal } from "./types.js";

export class WorkingMemoryManager {
  constructor(private memory: WorkingMemory) {}

  getState(): WorkingMemory {
    return this.memory;
  }

  update(updates: StateUpdates): void {
    const changes: string[] = [];

    if (updates.goals) {
      const before = this.memory.goals.length;
      this.memory.goals = updates.goals;
      changes.push(`goals: ${updates.goals.length - before > 0 ? '+' : ''}${updates.goals.length - before}`);
    }

    if (updates.semanticMemory) {
      const before = this.memory.semanticMemory.length;
      this.memory.semanticMemory.push(...updates.semanticMemory);
      changes.push(`semanticMemory: +${updates.semanticMemory.length}`);
    }

    if (updates.episodicMemory) {
      const before = this.memory.episodicMemory.length;
      this.memory.episodicMemory.push(...updates.episodicMemory);
      changes.push(`episodicMemory: +${updates.episodicMemory.length}`);
    }

    if (updates.proceduralMemory) {
      const before = this.memory.proceduralMemory.length;
      this.memory.proceduralMemory.push(...updates.proceduralMemory);
      changes.push(`proceduralMemory: +${updates.proceduralMemory.length}`);
    }

    if (updates.prospectiveMemory) {
      const before = this.memory.prospectiveMemory.length;
      this.memory.prospectiveMemory.push(...updates.prospectiveMemory);
      changes.push(`prospectiveMemory: +${updates.prospectiveMemory.length}`);
    }

    if (changes.length > 0) {
      console.log(`[WorkingMemory] Updated: ${changes.join(', ')}`);
    }
  }

  buildSummary(conversation: ConversationState | null | undefined): StateSummary {
    return {
      goals: this.memory.goals.map(g => ({
        id: g.id,
        description: g.description,
        status: g.status,
      })),
      memoryCounts: {
        semantic: this.memory.semanticMemory.length,
        episodic: this.memory.episodicMemory.length,
        procedural: this.memory.proceduralMemory.length,
        prospective: this.memory.prospectiveMemory.length,
      },
      messages: conversation?.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      })) || [],
    };
  }

  updateConversation(conversation: ConversationState): void {
    this.memory.conversation = conversation;
  }

  static initialize(
    conversation: ConversationState | null | undefined,
    relevantMemoriesText?: string
  ): WorkingMemory {
    const semanticMemory: string[] = [];
    
    if (relevantMemoriesText) {
      const memoryLines = relevantMemoriesText.split('\n').filter(l => l.trim());
      semanticMemory.push(...memoryLines.slice(0, 10));
    }

    return {
      goals: [],
      semanticMemory,
      episodicMemory: [],
      proceduralMemory: [],
      prospectiveMemory: [],
      conversation: conversation || {
        conversation: {
          id: "",
          label: "",
          type: "main",
          createdAt: Date.now(),
          lastActivity: Date.now(),
        },
        messages: [],
      },
    };
  }
}
