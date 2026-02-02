/**
 * Sleep mode - memory processing and consolidation
 * 
 * Sleep mode processes, summarizes, and consolidates memories before
 * the context window fills up, similar to how humans consolidate memories during sleep.
 */

export * from "./types.js";
export * from "./config.js";
export * from "./trigger.js";
export * from "./runner.js";
export * from "./processor.js";
export * from "./summarizer.js";
export * from "./consolidator.js";

// Main entry point
export { runSleepModeIfNeeded } from "./runner.js";
export type { SleepConfig, ContextMessage, ConsolidatedMemory } from "./types.js";
