/**
 * Memory Search Manager
 * Full implementation with SQLite, vector embeddings, and hybrid search
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ResolvedMemorySearchConfig } from "../../config.js";
import type { MemoryChunk } from "../encoding/chunking.js";
import { chunkMarkdown, hashText } from "../encoding/chunking.js";
import { parseEmbedding, cosineSimilarity } from "../encoding/embeddings.js";
import { ensureMemoryIndexSchema } from "../encoding/schema.js";
import { listMemoryFiles, buildFileEntry, type MemoryFileEntry } from "../storage/files.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "@server/world/providers/embeddings/index.js";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "conversations";
};

export interface MemorySearchManager {
  search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      conversationKey?: string;
    },
  ): Promise<MemorySearchResult[]>;

  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }>;

  status(): {
    files: number;
    chunks: number;
    dirty: boolean;
    workspaceDir: string;
    dbPath: string;
    provider: string;
    model: string;
    sources: Array<"memory" | "conversations">;
  };

  sync(params?: {
    reason?: string;
    force?: boolean;
  }): Promise<void>;

  close(): Promise<void>;
}

const MANAGER_CACHE = new Map<string, MemorySearchManager>();

class MemorySearchManagerImpl implements MemorySearchManager {
  private db: DatabaseSync | null = null;
  private config: ResolvedMemorySearchConfig;
  private workspaceDir: string;
  private embeddingProvider: EmbeddingProvider | null;
  private dirty = false;
  private ftsTable = "fts_memory";
  private embeddingCacheTable = "embedding_cache";

  constructor(config: ResolvedMemorySearchConfig, workspaceDir: string) {
    this.config = config;
    this.workspaceDir = workspaceDir;
    this.embeddingProvider = createEmbeddingProvider(config);
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    const dbPath = this.config.store.path;
    const dbDir = dirname(dbPath);
    
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    
    // Enable FTS5 if available
    const ftsEnabled = this.config.store.vector.enabled;
    const { ftsAvailable } = ensureMemoryIndexSchema({
      db: this.db,
      embeddingCacheTable: this.embeddingCacheTable,
      ftsTable: this.ftsTable,
      ftsEnabled,
    });

    if (!ftsAvailable && ftsEnabled) {
      console.warn("FTS5 not available, falling back to vector-only search");
    }
  }

  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      conversationKey?: string;
    },
  ): Promise<MemorySearchResult[]> {
    await this.initialize();
    if (!this.db) return [];

    const maxResults = opts?.maxResults ?? this.config.query.maxResults;
    const minScore = opts?.minScore ?? this.config.query.minScore;

    // Get query embedding if provider available
    let queryEmbedding: number[] | null = null;
    if (this.embeddingProvider) {
      try {
        queryEmbedding = await this.embeddingProvider.getEmbedding(query);
      } catch (error) {
        console.warn("Failed to get query embedding:", error);
      }
    }

    const results: Array<MemorySearchResult & { vectorScore?: number; ftsScore?: number }> = [];

    // Vector search
    if (queryEmbedding && this.config.query.hybrid.enabled) {
      const chunks = this.db.prepare(`
        SELECT id, path, source, start_line, end_line, text, embedding
        FROM chunks
        WHERE source IN (${this.config.sources.map(() => "?").join(",")})
      `).all(...this.config.sources) as Array<{
        id: string;
        path: string;
        source: string;
        start_line: number;
        end_line: number;
        text: string;
        embedding: string;
      }>;

      for (const chunk of chunks) {
        const chunkEmbedding = parseEmbedding(chunk.embedding);
        if (chunkEmbedding.length === 0) continue;

        const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
        if (similarity >= minScore) {
          results.push({
            path: chunk.path,
            startLine: chunk.start_line,
            endLine: chunk.end_line,
            score: similarity,
            snippet: this.extractSnippet(chunk.text, query),
            source: chunk.source as "memory" | "conversations",
            vectorScore: similarity,
          });
        }
      }
    }

    // FTS5 search (if available and hybrid enabled)
    if (this.config.query.hybrid.enabled) {
      try {
        const ftsResults = this.db.prepare(`
          SELECT id, path, source, start_line, end_line, text,
                 bm25(${this.ftsTable}) as rank
          FROM ${this.ftsTable}
          WHERE ${this.ftsTable} MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(query, maxResults * this.config.query.hybrid.candidateMultiplier) as Array<{
          id: string;
          path: string;
          source: string;
          start_line: number;
          end_line: number;
          text: string;
          rank: number;
        }>;

        // Normalize FTS scores (lower rank = better, so invert)
        const maxRank = Math.max(...ftsResults.map((r) => Math.abs(r.rank)), 1);
        
        for (const ftsResult of ftsResults) {
          const ftsScore = 1 - Math.abs(ftsResult.rank) / maxRank;
          
          // Find or create result entry
          const existing = results.find(
            (r) => r.path === ftsResult.path &&
                   r.startLine === ftsResult.start_line &&
                   r.endLine === ftsResult.end_line
          );

          if (existing) {
            existing.ftsScore = ftsScore;
            // Combine scores using hybrid weights
            existing.score = 
              (existing.vectorScore ?? 0) * this.config.query.hybrid.vectorWeight +
              ftsScore * this.config.query.hybrid.textWeight;
          } else if (ftsScore >= minScore) {
            results.push({
              path: ftsResult.path,
              startLine: ftsResult.start_line,
              endLine: ftsResult.end_line,
              score: ftsScore * this.config.query.hybrid.textWeight,
              snippet: this.extractSnippet(ftsResult.text, query),
              source: ftsResult.source as "memory" | "conversations",
              ftsScore,
            });
          }
        }
      } catch (error) {
        // FTS5 might not be available, continue with vector-only
        console.warn("FTS5 search failed:", error);
      }
    }

    // Fallback: simple text search if no embeddings
    if (results.length === 0 && !queryEmbedding) {
      const chunks = this.db.prepare(`
        SELECT path, source, start_line, end_line, text
        FROM chunks
        WHERE source IN (${this.config.sources.map(() => "?").join(",")})
          AND text LIKE ?
        LIMIT ?
      `).all(...this.config.sources, `%${query}%`, maxResults * 2) as Array<{
        path: string;
        source: string;
        start_line: number;
        end_line: number;
        text: string;
      }>;

      for (const chunk of chunks) {
        const score = this.textMatchScore(chunk.text, query);
        if (score >= minScore) {
          results.push({
            path: chunk.path,
            startLine: chunk.start_line,
            endLine: chunk.end_line,
            score,
            snippet: this.extractSnippet(chunk.text, query),
            source: chunk.source as "memory" | "conversations",
          });
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults).map(({ vectorScore, ftsScore, ...result }) => result);
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const filePath = join(this.workspaceDir, params.relPath);
    
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${params.relPath}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    const startLine = params.from ? Math.max(1, params.from) : 1;
    const endLine = params.lines 
      ? Math.min(lines.length, startLine + params.lines - 1)
      : lines.length;

    const selectedLines = lines.slice(startLine - 1, endLine);
    return {
      text: selectedLines.join("\n"),
      path: params.relPath,
    };
  }

  status(): {
    files: number;
    chunks: number;
    dirty: boolean;
    workspaceDir: string;
    dbPath: string;
    provider: string;
    model: string;
    sources: Array<"memory" | "conversations">;
  } {
    if (!this.db) {
      return {
        files: 0,
        chunks: 0,
        dirty: this.dirty,
        workspaceDir: this.workspaceDir,
        dbPath: this.config.store.path,
        provider: this.config.provider,
        model: this.config.model,
        sources: this.config.sources,
      };
    }

    const files = (this.db.prepare("SELECT COUNT(*) as count FROM files").get() as { count: number }).count;
    const chunks = (this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as { count: number }).count;

    return {
      files,
      chunks,
      dirty: this.dirty,
      workspaceDir: this.workspaceDir,
      dbPath: this.config.store.path,
      provider: this.config.provider,
      model: this.config.model,
      sources: this.config.sources,
    };
  }

  async sync(params?: { reason?: string; force?: boolean }): Promise<void> {
    await this.initialize();
    if (!this.db || !this.embeddingProvider) {
      console.warn("Cannot sync: database or embedding provider not available");
      return;
    }

    // List memory files
    const memoryFiles = await listMemoryFiles(
      this.workspaceDir,
      this.config.extraPaths
    );

    // Process each file
    for (const filePath of memoryFiles) {
      const fileEntry = await buildFileEntry(filePath, this.workspaceDir);
      
      // Check if file needs updating
      const existing = this.db.prepare("SELECT hash, mtime FROM files WHERE path = ?").get(fileEntry.path) as {
        hash: string;
        mtime: number;
      } | undefined;

      if (existing && !params?.force) {
        if (existing.hash === fileEntry.hash && existing.mtime === fileEntry.mtimeMs) {
          continue; // File unchanged
        }
      }

      // Read and chunk file
      const content = readFileSync(fileEntry.absPath, "utf-8");
      const chunks = chunkMarkdown(content, this.config.chunking);

      // Delete old chunks for this file
      this.db.prepare("DELETE FROM chunks WHERE path = ?").run(fileEntry.path);
      if (this.config.store.vector.enabled) {
        try {
          this.db.prepare(`DELETE FROM ${this.ftsTable} WHERE path = ?`).run(fileEntry.path);
        } catch {
          // FTS table might not exist
        }
      }

      // Process chunks and create embeddings
      const textsToEmbed = chunks.map((chunk) => chunk.text);
      let embeddings: number[][] = [];

      if (this.embeddingProvider) {
        try {
          // Batch embeddings if supported
          embeddings = await this.embeddingProvider.getEmbeddings(textsToEmbed);
        } catch (error) {
          console.warn(`Failed to get embeddings for ${fileEntry.path}:`, error);
          // Continue without embeddings
        }
      }

      // Insert chunks
      const insertChunk = this.db.prepare(`
        INSERT OR REPLACE INTO chunks 
        (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertFTS = this.config.store.vector.enabled
        ? this.db.prepare(`
            INSERT INTO ${this.ftsTable} 
            (id, path, source, start_line, end_line, model, text)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
        : null;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i] || [];
        const chunkId = `${fileEntry.path}:${chunk.startLine}:${chunk.endLine}`;
        const embeddingJson = JSON.stringify(embedding);

        insertChunk.run(
          chunkId,
          fileEntry.path,
          "memory",
          chunk.startLine,
          chunk.endLine,
          chunk.hash,
          this.config.model,
          chunk.text,
          embeddingJson,
          Date.now()
        );

        if (insertFTS) {
          try {
            insertFTS.run(
              chunkId,
              fileEntry.path,
              "memory",
              chunk.startLine,
              chunk.endLine,
              this.config.model,
              chunk.text
            );
          } catch (error) {
            // FTS might fail, continue
            console.warn("FTS insert failed:", error);
          }
        }
      }

      // Update file record
      this.db.prepare(`
        INSERT OR REPLACE INTO files (path, source, hash, mtime, size)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        fileEntry.path,
        "memory",
        fileEntry.hash,
        fileEntry.mtimeMs,
        fileEntry.size
      );
    }

    this.dirty = false;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private extractSnippet(text: string, query: string, maxLength = 200): string {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    const index = textLower.indexOf(queryLower);

    if (index === -1) {
      return text.slice(0, maxLength) + (text.length > maxLength ? "..." : "");
    }

    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + query.length + 50);
    let snippet = text.slice(start, end);

    if (start > 0) snippet = "..." + snippet;
    if (end < text.length) snippet = snippet + "...";

    return snippet;
  }

  private textMatchScore(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    if (queryWords.length === 0) return 0;

    const matches = queryWords.filter((word) => textLower.includes(word)).length;
    return matches / queryWords.length;
  }
}

export async function getMemorySearchManager(params: {
  config: ResolvedMemorySearchConfig;
  workspaceDir: string;
  agentId: string;
}): Promise<{ manager: MemorySearchManager | null; error?: string }> {
  const { config, workspaceDir, agentId } = params;

  if (!config.enabled) {
    return { manager: null };
  }

  const cacheKey = `${agentId}:${workspaceDir}:${JSON.stringify(config)}`;
  const cached = MANAGER_CACHE.get(cacheKey);
  if (cached) {
    return { manager: cached };
  }

  try {
    const manager = new MemorySearchManagerImpl(config, workspaceDir);
    await manager.initialize();

    // Auto-sync on creation if configured
    if (config.sync.onConversationStart) {
      await manager.sync({ reason: "conversation_start" });
    }

    MANAGER_CACHE.set(cacheKey, manager);
    return { manager };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manager: null, error: message };
  }
}

export async function createMemorySearchManager(
  config: ResolvedMemorySearchConfig,
  workspaceDir: string,
  agentId: string,
): Promise<MemorySearchManager | null> {
  const result = await getMemorySearchManager({ config, workspaceDir, agentId });
  return result.manager;
}
