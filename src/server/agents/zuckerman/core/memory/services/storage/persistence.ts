import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureHomedirDir } from "@server/world/homedir/resolver.js";

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0");
  const day = String(yesterday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolve memory directory path
 */
export function resolveMemoryDir(homedirDir: string): string {
  return join(homedirDir, "memory");
}

/**
 * Resolve daily memory file path
 */
export function resolveDailyMemoryPath(homedirDir: string, date?: string): string {
  const memoryDir = resolveMemoryDir(homedirDir);
  const dateStr = date || getTodayDate();
  return join(memoryDir, `${dateStr}.md`);
}

/**
 * Resolve long-term memory file path
 */
export function resolveLongTermMemoryPath(homedirDir: string): string {
  return join(homedirDir, "MEMORY.md");
}

/**
 * Load memory files for conversation start
 * Returns today + yesterday daily logs + long-term memory
 */
export function loadMemoryForConversation(homedirDir: string): {
  dailyLogs: Map<string, string>;
  longTermMemory: string;
} {
  ensureHomedirDir(homedirDir);
  const memoryDir = resolveMemoryDir(homedirDir);
  
  // Ensure memory directory exists
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const dailyLogs = new Map<string, string>();
  const today = getTodayDate();
  const yesterday = getYesterdayDate();

  // Load today's log
  const todayPath = resolveDailyMemoryPath(homedirDir, today);
  if (existsSync(todayPath)) {
    try {
      dailyLogs.set(today, readFileSync(todayPath, "utf-8"));
    } catch (error) {
      console.warn(`Failed to read today's memory file:`, error);
    }
  }

  // Load yesterday's log
  const yesterdayPath = resolveDailyMemoryPath(homedirDir, yesterday);
  if (existsSync(yesterdayPath)) {
    try {
      dailyLogs.set(yesterday, readFileSync(yesterdayPath, "utf-8"));
    } catch (error) {
      console.warn(`Failed to read yesterday's memory file:`, error);
    }
  }

  // Load long-term memory
  let longTermMemory = "";
  const memoryPath = resolveLongTermMemoryPath(homedirDir);
  if (existsSync(memoryPath)) {
    try {
      longTermMemory = readFileSync(memoryPath, "utf-8");
    } catch (error) {
      console.warn(`Failed to read long-term memory file:`, error);
    }
  }

  return { dailyLogs, longTermMemory };
}

/**
 * Append to today's daily memory log
 */
export function appendDailyMemory(homedirDir: string, content: string): void {
  ensureHomedirDir(homedirDir);
  const memoryDir = resolveMemoryDir(homedirDir);
  
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const todayPath = resolveDailyMemoryPath(homedirDir);
  const timestamp = new Date().toISOString();
  const entry = `\n\n---\n\n[${timestamp}]\n\n${content}\n`;

  try {
    appendFileSync(todayPath, entry, "utf-8");
  } catch (error) {
    console.error(`Failed to append to daily memory:`, error);
  }
}

/**
 * Update long-term memory (overwrites existing)
 */
export function updateLongTermMemory(homedirDir: string, content: string): void {
  ensureHomedirDir(homedirDir);
  const memoryPath = resolveLongTermMemoryPath(homedirDir);

  try {
    writeFileSync(memoryPath, content, "utf-8");
  } catch (error) {
    console.error(`Failed to update long-term memory:`, error);
  }
}

/**
 * Append to long-term memory
 */
export function appendLongTermMemory(homedirDir: string, content: string): void {
  ensureHomedirDir(homedirDir);
  const memoryPath = resolveLongTermMemoryPath(homedirDir);

  const timestamp = new Date().toISOString();
  const entry = `\n\n---\n\n[${timestamp}]\n\n${content}\n`;

  try {
    appendFileSync(memoryPath, entry, "utf-8");
  } catch (error) {
    console.error(`Failed to append to long-term memory:`, error);
  }
}

/**
 * Format memory for system prompt injection
 */
export function formatMemoryForPrompt(
  dailyLogs: Map<string, string>,
  longTermMemory: string,
): string {
  const parts: string[] = [];

  // Add long-term memory first (if exists)
  if (longTermMemory.trim()) {
    parts.push(`## Long-term Memory (MEMORY.md)\n\n${longTermMemory}`);
  }

  // Add daily logs
  if (dailyLogs.size > 0) {
    const dailyParts: string[] = [];
    for (const [date, content] of dailyLogs.entries()) {
      if (content.trim()) {
        dailyParts.push(`### ${date}\n\n${content}`);
      }
    }
    if (dailyParts.length > 0) {
      parts.push(`## Recent Memory (Daily Logs)\n\n${dailyParts.join("\n\n")}`);
    }
  }

  return parts.join("\n\n---\n\n");
}
