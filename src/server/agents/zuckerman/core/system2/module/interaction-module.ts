import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal } from "../types.js";

export class InteractionModule {
  constructor(
    private judgeModel: LLMModel,
    private systemPrompt: string
  ) {}

  async run(params: {
    userMessage: string;
    state: string;
  }): Promise<Proposal | null> {
    const prompt = `You are the Interaction Module (friendly conversation layer). Your job is to propose natural, human-like responses.

User message: "${params.userMessage}"
Current state: ${params.state}

Propose a warm, engaging reply. Only speak if it makes sense to respond directly.

IMPORTANT: If you don't think this module can contribute meaningfully at this stage, it's perfectly acceptable to return null or indicate very low confidence. Only propose something if you have a clear, valuable contribution.

Output ONLY valid JSON matching the Proposal structure:
{
  "module": "interaction",
  "confidence": 0.0-1.0,
  "priority": 0-10,
  "payload": {
    "message": "the exact message to send to the user"
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
      console.warn(`[InteractionModule] Validation failed:`, error);
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
        module: String(parsed.module || "interaction"),
        confidence,
        priority: Math.max(0, Math.min(10, Number(parsed.priority) || 0)),
        payload,
        reasoning: String(parsed.reasoning || "No reasoning provided"),
      };
    } catch (error) {
      console.warn(`[InteractionModule] Parse failed:`, error);
      return null;
    }
  }
}
