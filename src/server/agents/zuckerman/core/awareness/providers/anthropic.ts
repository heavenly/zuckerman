import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, jsonSchema, type Tool, type ModelMessage } from "ai";
import type { LLMProvider, LLMCallParams, LLMResponse, LLMMessage } from "./types.js";

/**
 * Anthropic provider using Vercel AI SDK
 * This implementation provides better error handling and streaming support
 */
export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private anthropic: ReturnType<typeof createAnthropic>;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }
    this.anthropic = createAnthropic({
      apiKey,
    });
  }

  async call(params: LLMCallParams): Promise<LLMResponse> {
    const {
      messages,
      systemPrompt,
      temperature = 1.0,
      maxTokens = 4096,
      model = "claude-3-5-sonnet-20241022",
      tools,
    } = params;

    // Convert messages to AI SDK format
    const aiMessages = this.convertMessages(messages, systemPrompt);

    // Convert tools to AI SDK ToolSet format
    const toolSet = tools?.reduce((acc, tool) => {
      acc[tool.function.name] = {
        description: tool.function.description,
        inputSchema: jsonSchema(tool.function.parameters as Record<string, unknown>),
      };
      return acc;
    }, {} as Record<string, Tool>);

    try {
      const result = await generateText({
        model: this.anthropic(model),
        messages: aiMessages,
        temperature,
        maxTokens: maxTokens,
        tools: toolSet,
      } as Parameters<typeof generateText>[0]);

      return {
        content: result.text,
        tokensUsed: result.usage
          ? {
              input: result.usage.inputTokens ?? 0,
              output: result.usage.outputTokens ?? 0,
              total: result.usage.totalTokens ?? 0,
            }
          : undefined,
        model: result.response?.modelId ?? model,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls?.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: JSON.stringify("input" in tc ? tc.input : {}),
        })),
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
      maxTokens = 4096,
      model = "claude-3-5-sonnet-20241022",
      tools,
    } = params;

    // Convert messages to AI SDK format
    const aiMessages = this.convertMessages(messages, systemPrompt);

    // Convert tools to AI SDK ToolSet format
    const toolSet = tools?.reduce((acc, tool) => {
      acc[tool.function.name] = {
        description: tool.function.description,
        inputSchema: jsonSchema(tool.function.parameters as Record<string, unknown>),
      };
      return acc;
    }, {} as Record<string, Tool>);

    try {
      const result = await streamText({
        model: this.anthropic(model),
        messages: aiMessages,
        temperature,
        maxTokens: maxTokens,
        tools: toolSet,
      } as Parameters<typeof streamText>[0]);

      for await (const chunk of result.textStream) {
        yield chunk;
      }
    } catch (error) {
      throw new Error(
        `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): ModelMessage[] {
    const aiMessages: ModelMessage[] = [];

    if (systemPrompt) {
      aiMessages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    for (const msg of messages) {
      // Skip invalid tool messages
      if (msg.role === "tool" && !msg.toolCallId) {
        console.warn("Skipping invalid tool message (missing toolCallId):", {
          content: msg.content.substring(0, 100),
        });
        continue;
      }

      if (msg.role === "system") {
        // System messages are handled separately
        continue;
      }

      if (msg.role === "tool" && msg.toolCallId) {
        aiMessages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: msg.toolCallId,
              result: msg.content || "",
            } as any,
          ],
        });
      } else if (msg.role === "assistant") {
        // Assistant messages with tool calls need to be split into separate messages
        // First add the assistant message with tool calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          aiMessages.push({
            role: "assistant",
            content: msg.content || "",
            toolCalls: msg.toolCalls.map((tc) => ({
              toolCallId: tc.id,
              toolName: tc.name,
              args: JSON.parse(tc.arguments),
            })),
          } as ModelMessage);
        } else {
          aiMessages.push({
            role: "assistant",
            content: msg.content || "",
          });
        }
      } else {
        // user role
        aiMessages.push({
          role: "user",
          content: msg.content || "",
        });
      }
    }

    return aiMessages;
  }
}
