import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal } from "../types.js";

export class CreativityModule {
  constructor(
    private judgeModel: LLMModel,
    private systemPrompt: string
  ) {}

  async run(params: {
    userMessage: string;
    state: string;
  }): Promise<Proposal | null> {
    // Parse state to extract conversation messages
    let parsedState: any;
    try {
      parsedState = JSON.parse(params.state);
    } catch {
      parsedState = { messages: [] };
    }

    const messages = parsedState.messages || [];
    const recentMessages = messages.slice(-10); // Last 10 messages for context

    const prompt = `You are the Creativity Module. Analyze the conversation and propose creative solutions ONLY if actual failures occurred.

User input: "${params.userMessage}"
Conversation: ${recentMessages.map((m: any) => `[${m.role}]: ${m.content?.substring(0, 150) || ''}`).join(' | ')}
State: ${params.state}

Look for actual failures: errors, tool failures, user corrections, repeated unsuccessful attempts.

If no failures found → return null (set confidence to 0.0). This is perfectly fine.

If failures found → propose 2-3 practical alternative solutions that address them.

Output JSON:
{
  "module": "creativity",
  "confidence": 0.0-1.0,
  "priority": 0-10,
  "payload": {
    "failuresIdentified": ["failure1", "failure2"],
    "solutions": [
      {
        "path": "brief solution",
        "addressesFailure": "which failure",
        "approach": "how it differs",
        "whyBetter": "why better"
      }
    ]
  },
  "reasoning": "brief explanation"
}`;

    try {
      const response = await this.judgeModel.call({
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        responseFormat: "json_object",
      });
      return this.parseResponse(response.content);
    } catch (error) {
      console.warn(`[CreativityModule] Validation failed:`, error);
      return null;
    }
  }

  private parseResponse(content: string): Proposal | null {
    try {
      const parsed = JSON.parse(content.trim());
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const payload = parsed.payload || {};
      const failuresIdentified = payload.failuresIdentified || [];
      const solutions = payload.solutions || [];
      
      // Return null if:
      // - Confidence is very low
      // - Payload is empty
      // - No failures identified (this is critical - creativity module should only work when failures exist)
      // - No solutions provided
      if (confidence < 0.1 || 
          Object.keys(payload).length === 0 || 
          failuresIdentified.length === 0 || 
          solutions.length === 0) {
        return null;
      }
      
      // Limit solutions to maximum 3
      const limitedSolutions = solutions.slice(0, 3);
      
      return {
        module: String(parsed.module || "creativity"),
        confidence,
        priority: Math.max(0, Math.min(10, Number(parsed.priority) || 0)),
        payload: {
          ...payload,
          solutions: limitedSolutions,
        },
        reasoning: String(parsed.reasoning || "No reasoning provided"),
      };
    } catch (error) {
      console.warn(`[CreativityModule] Parse failed:`, error);
      return null;
    }
  }
}
