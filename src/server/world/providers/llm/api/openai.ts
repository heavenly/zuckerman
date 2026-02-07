import type { LLMProvider, LLMCallParams, LLMResponse, LLMMessage, LLMModel } from "../types.js";
import {
  toOpenAIRequest,
  fromOpenAIResponse,
  parseOpenAIStreamChunk,
  type OpenAIRequest,
} from "./helpers/openai-helpers.js";

/**
 * OpenAI provider using direct HTTP requests
 * Based on OpenCode's implementation approach
 */
export class OpenAIProvider implements LLMProvider {
  name = "openai";
  model: LLMModel;
  protected apiKey: string;
  protected baseUrl = "https://api.openai.com/v1";
  protected customHeaders?: () => HeadersInit;

  constructor(apiKey: string, model: LLMModel, options?: { baseUrl?: string; customHeaders?: () => HeadersInit }) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }
    if (!model?.id) {
      throw new Error("Model is required");
    }
    this.apiKey = apiKey;
    this.model = model;
    if (options?.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
    if (options?.customHeaders) {
      this.customHeaders = options.customHeaders;
    }
  }

  protected getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.customHeaders) {
      return { ...headers, ...this.customHeaders() };
    }
    return headers;
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

    const requestBody = toOpenAIRequest({
      messages,
      systemPrompt,
      model: this.model.id,
      temperature,
      maxTokens,
      tools,
      stream: false,
      responseFormat,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
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
        throw new Error(`OpenAI API error: ${errorMessage}`);
      }

      const data = await response.json();
      const result = fromOpenAIResponse(data);

      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
        model: result.model,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls,
      };
    } catch (error) {
      throw new Error(
        `OpenAI API error: ${error instanceof Error ? error.message : String(error)}`
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

    const requestBody = toOpenAIRequest({
      messages,
      systemPrompt,
      model: this.model.id,
      temperature,
      maxTokens,
      tools,
      stream: true,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
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
        throw new Error(`OpenAI API error: ${errorMessage}`);
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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const chunk = parseOpenAIStreamChunk(line);
              if (chunk && chunk.choices && chunk.choices.length > 0) {
                const delta = chunk.choices[0].delta;
                if (delta?.content) {
                  yield delta.content;
                }
              }
            }
          }
        }

        // Process remaining buffer
        if (buffer) {
          const chunk = parseOpenAIStreamChunk(`data: ${buffer}`);
          if (chunk && chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            if (delta?.content) {
              yield delta.content;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      throw new Error(
        `OpenAI API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
