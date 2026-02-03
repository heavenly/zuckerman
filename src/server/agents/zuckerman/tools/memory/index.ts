import type { Tool } from "../terminal/index.js";
import type { ToolExecutionContext } from "../terminal/index.js";
import { loadConfig } from "@server/world/config/index.js";
import { resolveAgentHomedirDir } from "@server/world/homedir/resolver.js";
import { resolveMemorySearchConfig } from "@server/agents/zuckerman/core/memory/config.js";
import { getMemorySearchManager } from "@server/agents/zuckerman/core/memory/retrieval/search.js";
import {
  appendDailyMemory,
  appendLongTermMemory,
  updateLongTermMemory,
} from "@server/agents/zuckerman/core/memory/storage/persistence.js";

/**
 * Create memory search tool
 */
export function createMemorySearchTool(): Tool {
  return {
    definition: {
      name: "memory_search",
      description:
        "Semantically search MEMORY.md and memory/*.md files (and optional conversation transcripts) for relevant information. Use this before answering questions about prior work, decisions, dates, people, preferences, or todos. Returns top snippets with path and line numbers.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query - describe what you're looking for in natural language",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return (default: 6)",
          },
          minScore: {
            type: "number",
            description: "Minimum relevance score (0-1, default: 0.35)",
          },
        },
        required: ["query"],
      },
    },
    handler: async (params, _securityContext, executionContext) => {
      try {
        const query = params.query as string;
        if (!query || typeof query !== "string") {
          return {
            success: false,
            error: "Query parameter is required and must be a string",
          };
        }

        const config = await loadConfig();
        const agentId = "zuckerman";
        const homedirDir = executionContext?.homedirDir || resolveAgentHomedirDir(config, agentId);
        const memoryConfig = resolveMemorySearchConfig(
          config.agent?.memorySearch || {},
          homedirDir,
          agentId,
        );

        if (!memoryConfig) {
          return {
            success: false,
            error: "Memory search is not enabled",
            result: { results: [], disabled: true },
          };
        }

        const { manager, error } = await getMemorySearchManager({
          config: memoryConfig,
          workspaceDir: homedirDir,
          agentId,
        });

        if (!manager) {
          return {
            success: false,
            error: error || "Memory search manager not available",
            result: { results: [], disabled: true, error },
          };
        }

        const maxResults = typeof params.maxResults === "number" ? params.maxResults : undefined;
        const minScore = typeof params.minScore === "number" ? params.minScore : undefined;

        const results = await manager.search(query, {
          maxResults,
          minScore,
          conversationKey: executionContext?.conversationId,
        });

        const status = manager.status();

        return {
          success: true,
          result: {
            results,
            provider: status.provider,
            model: status.model,
            totalFiles: status.files,
            totalChunks: status.chunks,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          result: { results: [], disabled: true },
        };
      }
    },
  };
}

/**
 * Create memory get tool
 */
export function createMemoryGetTool(): Tool {
  return {
    definition: {
      name: "memory_get",
      description:
        "Read a specific file or section from MEMORY.md, memory/*.md, or configured memory paths. Use this after memory_search to read only the needed lines and keep context small. Supports reading specific line ranges.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to memory file (e.g., 'MEMORY.md', 'memory/2024-01-15.md')",
          },
          from: {
            type: "number",
            description: "Start line number (1-indexed, optional)",
          },
          lines: {
            type: "number",
            description: "Number of lines to read (optional, reads entire file if not specified)",
          },
        },
        required: ["path"],
      },
    },
    handler: async (params, _securityContext, executionContext) => {
      try {
        const relPath = params.path as string;
        if (!relPath || typeof relPath !== "string") {
          return {
            success: false,
            error: "Path parameter is required and must be a string",
          };
        }

        const config = await loadConfig();
        const agentId = "zuckerman";
        const homedirDir = executionContext?.homedirDir || resolveAgentHomedirDir(config, agentId);
        const memoryConfig = resolveMemorySearchConfig(
          config.agent?.memorySearch || {},
          homedirDir,
          agentId,
        );

        if (!memoryConfig) {
          return {
            success: false,
            error: "Memory search is not enabled",
            result: { path: relPath, text: "", disabled: true },
          };
        }

        const { manager, error } = await getMemorySearchManager({
          config: memoryConfig,
          workspaceDir: homedirDir,
          agentId,
        });

        if (!manager) {
          return {
            success: false,
            error: error || "Memory search manager not available",
            result: { path: relPath, text: "", disabled: true, error },
          };
        }

        const from = typeof params.from === "number" ? params.from : undefined;
        const lines = typeof params.lines === "number" ? params.lines : undefined;

        const result = await manager.readFile({
          relPath,
          from,
          lines,
        });

        return {
          success: true,
          result,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          result: { path: params.path as string, text: "", disabled: true },
        };
      }
    },
  };
}

/**
 * Create memory save tool for daily memory
 */
export function createMemorySaveTool(): Tool {
  return {
    definition: {
      name: "memory_save",
      description:
        "Save important information to today's daily memory log (memory/YYYY-MM-DD.md). Use this to record facts, decisions, preferences, or events that happened today.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The content to save to daily memory",
          },
        },
        required: ["content"],
      },
    },
    handler: async (params, _securityContext, executionContext) => {
      try {
        const content = params.content as string;
        if (!content || typeof content !== "string") {
          return {
            success: false,
            error: "Content parameter is required and must be a string",
          };
        }

        const config = await loadConfig();
        const agentId = "zuckerman";
        const homedirDir = executionContext?.homedirDir || resolveAgentHomedirDir(config, agentId);

        appendDailyMemory(homedirDir, content);

        return {
          success: true,
          result: {
            message: "Memory saved to daily log",
            path: `memory/${new Date().toISOString().split("T")[0]}.md`,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Create memory update tool for long-term memory
 */
export function createMemoryUpdateTool(): Tool {
  return {
    definition: {
      name: "memory_update",
      description:
        "Update or append to long-term memory (MEMORY.md). Use 'mode: append' to add new information, or 'mode: replace' to completely rewrite MEMORY.md with new content. Use this for persistent facts, preferences, or important information that should be remembered across conversations.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The content to save to long-term memory",
          },
          mode: {
            type: "string",
            enum: ["append", "replace"],
            description: "Whether to append to existing memory or replace it entirely (default: append)",
            default: "append",
          },
        },
        required: ["content"],
      },
    },
    handler: async (params, _securityContext, executionContext) => {
      try {
        const content = params.content as string;
        const mode = (params.mode as "append" | "replace") || "append";

        if (!content || typeof content !== "string") {
          return {
            success: false,
            error: "Content parameter is required and must be a string",
          };
        }

        const config = await loadConfig();
        const agentId = "zuckerman";
        const homedirDir = executionContext?.homedirDir || resolveAgentHomedirDir(config, agentId);

        if (mode === "replace") {
          updateLongTermMemory(homedirDir, content);
        } else {
          appendLongTermMemory(homedirDir, content);
        }

        return {
          success: true,
          result: {
            message: `Long-term memory ${mode === "replace" ? "updated" : "appended"}`,
            path: "MEMORY.md",
            mode,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
