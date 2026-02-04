/**
 * Memory Indexing Service
 * Handles indexing memory files into the database for search
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { ResolvedMemorySearchConfig } from "../../config.js";
import { chunkMarkdown } from "../encoding/chunking.js";
import { listMemoryFiles, buildFileEntry } from "./files.js";
import type { EmbeddingProvider } from "@server/world/providers/embeddings/index.js";

export interface MemoryIndexer {
  sync(params?: {
    reason?: string;
    force?: boolean;
  }): Promise<void>;
}

export class MemoryIndexerImpl implements MemoryIndexer {
  private db: DatabaseSync;
  private config: ResolvedMemorySearchConfig;
  private workspaceDir: string;
  private embeddingProvider: EmbeddingProvider | null;
  private ftsTable: string;

  constructor(
    db: DatabaseSync,
    config: ResolvedMemorySearchConfig,
    workspaceDir: string,
    embeddingProvider: EmbeddingProvider | null,
    ftsTable: string,
  ) {
    this.db = db;
    this.config = config;
    this.workspaceDir = workspaceDir;
    this.embeddingProvider = embeddingProvider;
    this.ftsTable = ftsTable;
  }

  async sync(params?: { reason?: string; force?: boolean }): Promise<void> {
    if (!this.embeddingProvider) {
      console.warn("[Memory] Cannot sync: embedding provider not available");
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

    if (params?.reason) {
      console.log(`[Memory] Indexing sync completed: ${params.reason}`);
    }
  }
}
