import type { LLMModel } from "@server/world/providers/llm/index.js";
import type { Proposal, ModuleInput } from "../types.js";

export abstract class BaseModule {
  constructor(
    protected judgeModel: LLMModel,
    protected systemPrompt: string
  ) {}

  abstract run(input: ModuleInput): Promise<Proposal | null>;

  protected parseResponse(content: string, moduleName: string): Proposal | null {
    try {
      const parsed = JSON.parse(content.trim());
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const payload = parsed.payload || {};
      
      // Return null if confidence is very low or payload is empty
      if (confidence < 0.1 || Object.keys(payload).length === 0) {
        return null;
      }
      
      return {
        module: String(parsed.module || moduleName),
        confidence,
        priority: Math.max(0, Math.min(10, Number(parsed.priority) || 0)),
        payload,
        reasoning: String(parsed.reasoning || "No reasoning provided"),
      };
    } catch (error) {
      console.warn(`[${moduleName}] Parse failed:`, error);
      return null;
    }
  }
}
