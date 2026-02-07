import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal } from "../types.js";

export class CriticismModule {
  constructor(
    private judgeModel: LLMModel,
    private systemPrompt: string
  ) {}

  async run(params: {
    userMessage: string;
    state: string;
  }): Promise<Proposal | null> {
    const prompt = `You are the Criticism Module — the agent's sharp inner critic.

Your job is to examine the current proposals from other modules and the shared state, then provide honest, constructive criticism.

Current user input: "${params.userMessage}"
Current proposals from other modules and shared state summary: ${params.state}

Critically evaluate:
- Logical flaws or contradictions
- Potential risks or bad outcomes
- Missed opportunities
- Overconfidence or unrealistic assumptions
- Better alternatives
- Low quality outputs or solutions
- Not meeting best standards or best practices

Then propose a refined or corrected direction.

IMPORTANT: If you don't think this module can contribute meaningfully at this stage (e.g., no significant issues found with proposals), it's perfectly acceptable to return null or indicate very low confidence. Only propose something if you have a clear, valuable contribution.

Output ONLY valid JSON matching the Proposal structure:
{
  "module": "criticism",
  "confidence": 0.0-1.0,
  "priority": 0-10,
  "payload": {
    "critique": "clear summary of problems found",
    "suggestion": "recommended improvement or alternative",
    "severity": "low" | "medium" | "high"
  },
  "reasoning": "brief explanation"
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
      console.warn(`[CriticismModule] Validation failed:`, error);
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
        module: String(parsed.module || "criticism"),
        confidence,
        priority: Math.max(0, Math.min(10, Number(parsed.priority) || 0)),
        payload,
        reasoning: String(parsed.reasoning || "No reasoning provided"),
      };
    } catch (error) {
      console.warn(`[CriticismModule] Parse failed:`, error);
      return null;
    }
  }
}
