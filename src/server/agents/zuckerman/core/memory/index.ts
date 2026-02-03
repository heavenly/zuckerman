// Core exports
export * from "./config.js"; // Memory search configuration

// Memory Types and Interfaces
export * from "./types.js";

// Memory Stores (Data Storage)
export * from "./stores/working/index.js";
export * from "./stores/episodic/index.js";
export * from "./stores/procedural/index.js";
export * from "./stores/prospective/index.js";
export * from "./stores/emotional/index.js";

// Memory Manager (Unified Interface)
export * from "./manager.js"; // Unified Memory Manager

// Services: Encoding, Storage, Retrieval
export * from "./services/encoding/schema.js"; // Database schema
export * from "./services/encoding/chunking.js"; // Text chunking
export * from "./services/encoding/embeddings.js"; // Embedding utilities
export * from "./services/storage/persistence.js"; // Daily/long-term persistence
export * from "./services/storage/files.js"; // File operations
export * from "./services/retrieval/search.js"; // Search interface

// Note: Processing/consolidation logic moved to sleep module
// Note: Memory flush logic moved to sleep module

// Type exports
export type { MemorySearchManager, MemorySearchResult } from "./services/retrieval/search.js";
export type { MemoryFileEntry } from "./services/storage/files.js";
export type { MemoryChunk } from "./services/encoding/chunking.js";
export type { ResolvedMemorySearchConfig, MemorySearchConfig } from "./config.js";

// Function exports (matching OpenClaw pattern)
export { getMemorySearchManager } from "./services/retrieval/search.js";
export { UnifiedMemoryManager } from "./manager.js";
