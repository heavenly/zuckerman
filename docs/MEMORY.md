# Memory System Flow

## Overview

The memory system consists of two main modules:
- **Memory Module** (`core/memory/`) - Storage, retrieval, and search
- **Sleep Module** (`sleep/`) - Processing, summarization, and consolidation

Sleep mode is inspired by human sleep - a period where the agent processes, consolidates, and saves memories before the context window fills up.

## Data Flow Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        MEMORY SYSTEM FLOW                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│  User Message   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Agent Runtime (ZuckermanAwareness)     │
│  ┌─────────────────────────────────────┐ │
│  │ 1. Check Sleep Mode Trigger         │ │
│  │    ├─→ Check token usage            │ │
│  │    ├─→ Check if >= 80% threshold    │ │
│  │    └─→ If yes → ENTER SLEEP MODE   │ │
│  └─────────────────────────────────────┘ │
│         │                                 │
│         ▼                                 │
│  ┌─────────────────────────────────────┐ │
│  │ 2. Sleep Mode (if triggered)        │ │
│  │    ├─→ Phase 1: Process            │ │
│  │    │   └─→ Analyze conversation     │ │
│  │    │       history                   │ │
│  │    │                                 │ │
│  │    ├─→ Phase 2: Summarize           │ │
│  │    │   └─→ Extract key points       │ │
│  │    │   └─→ Compress old messages     │ │
│  │    │                                 │ │
│  │    ├─→ Phase 3: Consolidate         │ │
│  │    │   └─→ Identify important       │ │
│  │    │       memories                  │ │
│  │    │   └─→ Categorize by type       │ │
│  │    │                                 │ │
│  │    └─→ Phase 4: Save                │ │
│  │        ├─→ Save to daily log        │ │
│  │        │   (memory/YYYY-MM-DD.md)   │ │
│  │        └─→ Update long-term         │ │
│  │            (MEMORY.md)               │ │
│  └─────────────────────────────────────┘ │
│         │                                 │
│         ▼                                 │
│  ┌─────────────────────────────────────┐ │
│  │ 3. Load Existing Memories           │ │
│  │    ├─→ MEMORY.md (long-term)        │ │
│  │    ├─→ memory/YYYY-MM-DD.md (today) │ │
│  │    └─→ memory/YYYY-MM-DD.md (yesterday)│ │
│  └─────────────────────────────────────┘ │
│         │                                 │
│         ▼                                 │
│  ┌─────────────────────────────────────┐ │
│  │ 4. Build System Prompt              │ │
│  │    └─→ Inject memories into prompt  │ │
│  └─────────────────────────────────────┘ │
│         │                                 │
│         ▼                                 │
│  ┌─────────────────────────────────────┐ │
│  │ 5. Process Message                   │ │
│  │    ├─→ LLM generates response       │ │
│  │    └─→ May call tools (including    │ │
│  │        memory_save, memory_update)    │ │
│  └─────────────────────────────────────┘ │
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  Conversation Manager                   │
│  └─→ Save to transcript (.jsonl)       │
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  Memory Files (Updated)                │
│  ├─→ MEMORY.md (long-term)             │
│  └─→ memory/YYYY-MM-DD.md (daily logs) │
└─────────────────────────────────────────┘
```

## Memory Storage Map

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY STORAGE STRUCTURE                  │
└─────────────────────────────────────────────────────────────┘

{homedirDir}/
├── MEMORY.md                    ← Long-term memory
│   └─→ Persistent facts, preferences, important info
│
└── memory/
    ├── 2024-02-01.md            ← Yesterday's log
    ├── 2024-02-02.md            ← Today's log
    └── 2024-02-03.md            ← Future logs
```

## Memory Tools Map

```
┌─────────────────────────────────────────────────────────────┐
│                      MEMORY TOOLS                            │
└─────────────────────────────────────────────────────────────┘

memory_search
    └─→ Search MEMORY.md and memory/*.md files
        └─→ Returns relevant snippets with paths/line numbers

memory_get
    └─→ Read specific memory file or line range
        └─→ Use after memory_search to read details

memory_save
    └─→ Save to today's daily log (memory/YYYY-MM-DD.md)
        └─→ For facts, decisions, events of today

memory_update
    └─→ Update long-term memory (MEMORY.md)
        ├─→ mode: append → Add new info
        └─→ mode: replace → Rewrite entire file
```

## Sleep Mode Trigger

```
┌─────────────────────────────────────────────────────────────┐
│                    SLEEP MODE TRIGGER                        │
└─────────────────────────────────────────────────────────────┘

Context Window Usage
    │
    ├─→ totalTokens < 80% threshold → Continue normally
    │
    └─→ totalTokens >= 80% threshold → Trigger Sleep Mode
            │
            ├─→ threshold = contextWindow * 0.8 (80%)
            │
            ├─→ Cooldown check (default: 5 minutes)
            │
            └─→ Sleep Mode Phases:
                    │
                    ├─→ Process: Analyze conversation
                    ├─→ Summarize: Compress old messages
                    ├─→ Consolidate: Organize memories
                    └─→ Save: Persist to memory files
```

### Sleep Mode Phases

1. **Process** - Analyzes conversation history to identify important information
2. **Summarize** - Compresses old messages using various strategies (sliding-window, progressive-summary, importance-based, hybrid)
3. **Consolidate** - Categorizes memories by type (fact, preference, decision, event, learning) and importance
4. **Save** - Persists memories to daily logs and long-term storage using Memory module APIs

## Complete Memory Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│              MEMORY LIFECYCLE (Full Cycle)                   │
└─────────────────────────────────────────────────────────────┘

Conversation Start
    │
    ├─→ Load MEMORY.md
    ├─→ Load memory/YYYY-MM-DD.md (today)
    ├─→ Load memory/YYYY-MM-DD.md (yesterday)
    │
    └─→ Inject into system prompt
            │
            ▼
    User Interaction
            │
            ├─→ Check sleep mode trigger (80% threshold)
            │   └─→ If yes → Enter sleep mode
            │       ├─→ Process conversation
            │       ├─→ Summarize old messages
            │       ├─→ Consolidate memories
            │       └─→ Save to memory files
            │
            ├─→ Process message
            │   └─→ Agent may use memory tools
            │
            └─→ Save to transcript
                    │
                    ▼
    Memory Files Updated
            │
            ├─→ Daily logs (memory/YYYY-MM-DD.md)
            └─→ Long-term (MEMORY.md)
                    │
                    ▼
    Next Conversation
            └─→ Loads updated memories
```
