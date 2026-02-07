import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Proposal } from "./types.js";
import type { ConversationManager } from "@server/agents/zuckerman/conversations/index.js";
import type { RunContext } from "@server/world/providers/llm/context.js";

export async function writeProposalsToFile(
  proposals: Proposal[],
  userMessage: string,
  stateSummary: string,
  conversationManager: ConversationManager,
  context: RunContext
): Promise<void> {
  try {
    const proposalsDir = join(context.homedir, "system2", "proposals");
    await mkdir(proposalsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `proposals-${timestamp}.json`;
    const filePath = join(proposalsDir, fileName);

    const conversation = conversationManager.getConversation(context.conversationId);
    let state: unknown;
    try {
      state = JSON.parse(stateSummary);
    } catch {
      state = stateSummary;
    }

    const data = {
      timestamp: new Date().toISOString(),
      runId: context.runId,
      conversationId: context.conversationId,
      userMessage,
      state,
      conversation: {
        messages: conversation?.messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
          ignore: m.ignore,
        })) || [],
      },
      proposals: proposals.map(p => ({
        module: p.module,
        confidence: p.confidence,
        priority: p.priority,
        payload: p.payload,
        reasoning: p.reasoning,
      })),
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[System2] Wrote ${proposals.length} proposals to ${filePath}`);
  } catch (error) {
    console.warn(`[System2] Failed to write proposals to file:`, error);
  }
}
