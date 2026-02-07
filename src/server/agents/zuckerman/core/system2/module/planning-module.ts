import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal } from "../types.js";

export class PlanningModule {
  constructor(
    private judgeModel: LLMModel,
    private systemPrompt: string
  ) {}

  async run(params: {
    userMessage: string;
    state: string;
  }): Promise<Proposal | null> {
    const prompt = `You are the Reasoning & Planning Module. Your job is to think step-by-step and manage goals/tasks.

User input: "${params.userMessage}"
Current state: ${params.state}

Decide whether to:
- Decompose a goal into sub-goals
- Mark goals complete
- Create new goals
- Suggest next logical step

IMPORTANT: If you don't think this module can contribute meaningfully at this stage (e.g., no planning or goal management needed), it's perfectly acceptable to return null or indicate very low confidence. Only propose something if you have a clear, valuable contribution.

Output ONLY valid JSON matching the Proposal structure:
{
  "module": "reasoning_planning",
  "confidence": 0.0-1.0,
  "priority": 0-10,
  "payload": {
    "action": "decompose" | "update_memory" | "call_tool",
    "goals": [...],
    "subGoals": [...]
  },
  "reasoning": "brief explanation of your plan"
}`;

    try {
      const response = await this.judgeModel.call({
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        responseFormat: "json_object",
      });
      return this.parseResponse(response.content);
    } catch (error) {
      console.warn(`[PlanningModule] Validation failed:`, error);
      return null;
    }
  }

  private parseResponse(content: string): Proposal | null {
    try {
      const parsed = JSON.parse(content.trim());
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const payload = parsed.payload || {};
      
      // Return null if confidence is very low or payload is empty - module doesn't think it can help
      if (confidence < 0.1 || Object.keys(payload).length === 0) {
        return null;
      }
      
      return {
        module: String(parsed.module || "reasoning_planning"),
        confidence,
        priority: Math.max(0, Math.min(10, Number(parsed.priority) || 0)),
        payload,
        reasoning: String(parsed.reasoning || "No reasoning provided"),
      };
    } catch (error) {
      console.warn(`[PlanningModule] Parse failed:`, error);
      return null;
    }
  }
}
