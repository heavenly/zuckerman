// Core exports
export * from "../personality/personality-loader.js"; // Personality/prompt loader
export * from "./config.js"; // Memory search configuration

// Encoding: How memories are created
export * from "./encoding/schema.js"; // Database schema
export * from "./encoding/chunking.js"; // Text chunking
export * from "./encoding/embeddings.js"; // Embedding utilities

// Storage: Where memories persist
export * from "./storage/persistence.js"; // Daily/long-term persistence
export * from "./storage/files.js"; // File operations

// Retrieval: How memories are accessed
export * from "./retrieval/search.js"; // Search interface

// Note: Processing/consolidation logic moved to sleep module
// Note: Memory flush logic moved to sleep module

// Type exports
export type { MemorySearchManager, MemorySearchResult } from "./retrieval/search.js";
export type { MemoryFileEntry } from "./storage/files.js";
export type { MemoryChunk } from "./encoding/chunking.js";
export type { ResolvedMemorySearchConfig, MemorySearchConfig } from "./config.js";

// Function exports (matching OpenClaw pattern)
export { getMemorySearchManager } from "./retrieval/search.js";
