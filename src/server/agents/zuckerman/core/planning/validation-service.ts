import type { LLMModel } from "@server/world/providers/llm/index.js";

export interface ValidationResult {
  satisfied: boolean;
  reason: string;
  missing: string[];
}

export class ValidationService {
  constructor(private judgeModel: LLMModel) {}

  /**
   * Validate if system result satisfies user request
   */
  async validate(params: {
    userRequest: string;
    systemResult: string;
  }): Promise<ValidationResult> {
    const prompt = `User asked: "${params.userRequest}"

System did: ${params.systemResult}

Does the system result satisfy what the user asked for?

Respond in JSON format:
{
  "satisfied": true/false,
  "reason": "brief explanation",
  "missing": ["what's still needed if not satisfied"]
}`;

    try {
      const response = await this.judgeModel.call({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });

      return this.parseResponse(response.content);
    } catch (error) {
      console.warn(`[ValidationService] Validation call failed:`, error);
      // Return not satisfied on error to be safe
      return {
        satisfied: false,
        reason: "Validation failed",
        missing: [],
      };
    }
  }

  /**
   * Parse LLM response into ValidationResult
   */
  private parseResponse(content: string): ValidationResult {
    try {
      // Try to extract JSON from response (might have markdown code blocks)
      let jsonStr = content.trim();
      
      // Remove markdown code blocks if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      // Try to find JSON object in the response
      const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonStr = jsonObjectMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      
      return {
        satisfied: Boolean(parsed.satisfied),
        reason: String(parsed.reason || "No reason provided"),
        missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
      };
    } catch (error) {
      console.warn(`[ValidationService] Failed to parse validation response:`, error);
      console.warn(`[ValidationService] Response content:`, content);
      
      // Fallback: try to infer from text
      const lowerContent = content.toLowerCase();
      const isSatisfied = lowerContent.includes('"satisfied": true') || 
                         lowerContent.includes("satisfied: true") ||
                         (lowerContent.includes("yes") && !lowerContent.includes("not"));
      
      return {
        satisfied: isSatisfied,
        reason: "Could not parse validation response",
        missing: [],
      };
    }
  }
}
