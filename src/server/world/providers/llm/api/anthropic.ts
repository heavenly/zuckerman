import type { LLMProvider, LLMCallParams, LLMResponse, LLMModel } from "../types.js";
import {
  toAnthropicRequest,
  fromAnthropicResponse,
  parseAnthropicStreamChunk,
  type AnthropicRequest,
} from "./helpers/anthropic-helpers.js";

/**
 * Anthropic provider using direct HTTP requests
 * Based on OpenCode's implementation approach
 */
export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  model: LLMModel;
  private apiKey: string;
  private baseUrl = "https://api.anthropic.com/v1";

  constructor(apiKey: string, model: LLMModel) {
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }
    if (!model?.id) {
      throw new Error("Model is required");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async call(params: LLMCallParams): Promise<LLMResponse> {
    const {
      messages,
      systemPrompt,
      temperature = 1.0,
      maxTokens,
      tools,
      responseFormat,
    } = params;

    const requestBody = toAnthropicRequest({
      messages,
      systemPrompt,
      model: this.model.id,
      temperature,
      maxTokens,
      tools,
      stream: false,
    });

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      };

      // Add beta header for models with extended context (Sonnet 4.5+ and Opus 4.6+)
      if (this.model.id.startsWith("claude-sonnet-") || this.model.id.startsWith("claude-opus-4-6")) {
        headers["anthropic-beta"] = "context-1m-2025-08-07";
      }

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...requestBody,
          service_tier: "standard_only",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${errorText}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorMessage;
        } catch {
          // Use text as-is
        }
        throw new Error(`Anthropic API error: ${errorMessage}`);
      }

      const data = await response.json();
      const result = fromAnthropicResponse(data);

      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
        model: result.model,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls,
      };
    } catch (error) {
      throw new Error(
        `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async *stream(params: LLMCallParams): AsyncIterable<string> {
    const {
      messages,
      systemPrompt,
      temperature = 1.0,
      maxTokens,
      tools,
    } = params;

    const requestBody = toAnthropicRequest({
      messages,
      systemPrompt,
      model: this.model.id,
      temperature,
      maxTokens,
      tools,
      stream: true,
    });

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      };

      // Add beta header for models with extended context (Sonnet 4.5+ and Opus 4.6+)
      if (this.model.id.startsWith("claude-sonnet-") || this.model.id.startsWith("claude-opus-4-6")) {
        headers["anthropic-beta"] = "context-1m-2025-08-07";
      }

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...requestBody,
          service_tier: "standard_only",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${errorText}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorMessage;
        } catch {
          // Use text as-is
        }
        throw new Error(`Anthropic API error: ${errorMessage}`);
      }

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const chunk = parseAnthropicStreamChunk(line);
            if (chunk) {
              if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" && chunk.delta.text) {
                yield chunk.delta.text;
              }
            }
          }
        }

        // Process remaining buffer
        if (buffer) {
          const chunk = parseAnthropicStreamChunk(buffer);
          if (chunk && chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" && chunk.delta.text) {
            yield chunk.delta.text;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      throw new Error(
        `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
