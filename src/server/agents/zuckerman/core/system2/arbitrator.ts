import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal, Decision, WorkingMemory, StateSummary } from "./types.js";
import { Action } from "./types.js";

const ARBITRATOR_PROMPT = `
You are the Global Workspace — the central conscious brain of the agent.

Proposals from modules:
{proposals}

Current state:
{stateSummary}

Recent conversation (last 3):
{recentMessages}

CRITICAL RULES:
1. If the last message is already an assistant response, DO NOT select "respond" unless:
   - There are new tool results to communicate
   - There are pending goals to address
   - The user needs a progress update
2. If task is complete and you've already responded, use "termination"
3. Only use "respond" when you have something NEW to communicate

Your task:
- Read all proposals carefully
- Check recent conversation - have we already responded?
- Choose the SINGLE best proposal based on confidence, priority, and coherence
- Decide the action(s) based on the chosen payload
- You can return a SINGLE action or an ARRAY of actions to execute sequentially

Actions:
- "respond": Send message to user (continues cycle) - ONLY if we haven't responded OR there's new info
- "decompose": Break goal into sub-goals (continues cycle)
- "call_tool": Execute a tool (continues cycle)
- "termination": End processing cycle - USE THIS if already responded and nothing else to do

If using an array of actions, payload should be an array matching the actions (same length).

Output ONLY valid JSON:
{
  "selectedModule": "module_name",
  "action": "respond" | ["respond", "call_tool"] | "decompose" | "call_tool" | "termination",
  "payload": { ... } | [{ ... }, { ... }],
  "stateUpdates": {
    "goals": [...],
    "semanticMemory": [...],
    ...
  },
  "reasoning": "brief explanation"
}
`;

export async function arbitrate(
  proposals: Proposal[],
  memory: WorkingMemory,
  judgeModel: LLMModel,
  systemPrompt: string,
  recentMessages?: Array<{ role: string; content: string; timestamp?: number }>
): Promise<Decision | null> {
  const strongProposals = proposals.filter(p => p.confidence > 0.3);

  if (strongProposals.length === 0) {
    console.warn("[Arbitrator] No strong proposals found");
    return null;
  }

  const stateSummary: StateSummary = {
    goals: memory.goals.map(g => ({ id: g.id, description: g.description, status: g.status })),
    memoryCounts: {
      semantic: memory.semanticMemory.slice(0, 5).length,
      episodic: memory.episodicMemory.slice(0, 5).length,
      procedural: memory.proceduralMemory.slice(0, 5).length,
      prospective: memory.prospectiveMemory.slice(0, 5).length,
    },
    messages: memory.conversation.messages.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
    })),
  };

  const recentMessagesText = recentMessages && recentMessages.length > 0
    ? recentMessages.slice(-3).map(m => `[${m.role}]: ${m.content?.substring(0, 200) || ''}`).join('\n')
    : 'No recent messages';

  const prompt = ARBITRATOR_PROMPT
    .replace('{proposals}', JSON.stringify(strongProposals, null, 2))
    .replace('{stateSummary}', JSON.stringify(stateSummary, null, 2))
    .replace('{recentMessages}', recentMessagesText);

  try {
    const response = await judgeModel.call({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    return parseResponse(response.content);
  } catch (error) {
    console.error("[Arbitrator] Error:", error);
    return null;
  }
}

function parseResponse(content: string): Decision | null {
  try {
    let jsonStr = content.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];
    
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    
    const validActions = Object.values(Action);
    
    let action: Action | Action[];
    if (Array.isArray(parsed.action)) {
      action = parsed.action.filter((a: string) => validActions.includes(a as Action)) as Action[];
      if (action.length === 0) {
        action = Action.Respond; // Fallback
      }
    } else {
      action = validActions.includes(parsed.action as Action) 
        ? (parsed.action as Action)
        : Action.Respond;
    }

    return {
      selectedModule: String(parsed.selectedModule || "unknown"),
      action,
      payload: parsed.payload || (Array.isArray(action) ? [] : {}),
      stateUpdates: parsed.stateUpdates || {},
      reasoning: String(parsed.reasoning || "No reasoning provided"),
    };
  } catch (error) {
    console.warn("[Arbitrator] Parse failed:", error);
    return null;
  }
}
