import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal } from "../types.js";

export class AttentionModule {
  constructor(
    private judgeModel: LLMModel,
    private systemPrompt: string
  ) {}

  async run(params: {
    userMessage: string;
    state: string;
  }): Promise<Proposal | null> {
    const prompt = `You are the Attention Module. Your job is to decide what deserves focus right now.

User input: "${params.userMessage}"
Current state: ${params.state}

Propose what the agent should focus on or ignore. This helps handle interruptions and multitasking.

IMPORTANT: If you don't think this module can contribute meaningfully at this stage (e.g., focus is already clear), it's perfectly acceptable to return null or indicate very low confidence. Only propose something if you have a clear, valuable contribution.

Output ONLY valid JSON matching the Proposal structure:
{
  "module": "attention",
  "confidence": 0.0-1.0,
  "priority": 0-10,
  "payload": {
    "focus": "short description of what to focus on",
    "ignore": "optional: what to deprioritize"
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
      console.warn(`[AttentionModule] Validation failed:`, error);
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
        module: String(parsed.module || "attention"),
        confidence,
        priority: Math.max(0, Math.min(10, Number(parsed.priority) || 0)),
        payload,
        reasoning: String(parsed.reasoning || "No reasoning provided"),
      };
    } catch (error) {
      console.warn(`[AttentionModule] Parse failed:`, error);
      return null;
    }
  }
}
