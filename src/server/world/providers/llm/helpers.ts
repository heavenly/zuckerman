import type { ModelMessage } from "ai";
import type { ConversationMessage } from "@server/agents/zuckerman/conversations/types.js";

/**
 * Convert ConversationMessage[] to ModelMessage[]
 * ConversationMessage matches ModelMessage format, so conversion is straightforward
 */
export function convertToModelMessages(
  messages: ConversationMessage[]
): ModelMessage[] {
  return messages
    .filter((msg) => {
      if (msg.ignore) return false;
      
      // TypeScript narrows types based on discriminated union
      if (msg.role === "system") {
        return msg.content.trim().length > 0;
      }
      
      if (msg.role === "tool") {
        return msg.content.length > 0;
      }
      
      // User and assistant messages can be string or array
      if (typeof msg.content === "string") {
        return msg.content.trim().length > 0;
      }
      return msg.content.length > 0;
    })
    .map((msg): ModelMessage => ({
      role: msg.role,
      content: msg.content,
    }) as ModelMessage);
}

