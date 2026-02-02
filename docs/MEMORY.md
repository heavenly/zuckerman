# Memory System Flow

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
│  │ 1. Check Memory Flush Needed       │ │
│  │    ├─→ Check token usage            │ │
│  │    ├─→ Check context window limit   │ │
│  │    └─→ If threshold met → FLUSH     │ │
│  └─────────────────────────────────────┘ │
│         │                                 │
│         ▼                                 │
│  ┌─────────────────────────────────────┐ │
│  │ 2. Memory Flush (if needed)         │ │
│  │    ├─→ Prompt: "Store memories now"  │ │
│  │    ├─→ Agent uses tools to save      │ │
│  │    └─→ Updates memory files          │ │
│  └─────────────────────────────────────┘ │
│         │                                 │
│         ▼                                 │
│  ┌─────────────────────────────────────┐ │
│  │ 3. Load Existing Memories           │ │
│  │    ├─→ MEMORY.md (long-term)        │ │
│  │    ├─→ memory/YYYY-MM-DD.md (today)  │ │
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

{landDir}/
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

## Memory Flush Trigger Map

```
┌─────────────────────────────────────────────────────────────┐
│                  MEMORY FLUSH TRIGGER                        │
└─────────────────────────────────────────────────────────────┘

Context Window Usage
    │
    ├─→ totalTokens < threshold → Continue normally
    │
    └─→ totalTokens >= threshold → Trigger Memory Flush
            │
            ├─→ threshold = contextWindow - reserveTokens - softThreshold
            │
            └─→ Agent receives prompt: "Store durable memories now"
                    │
                    └─→ Agent saves memories using tools
```

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
            ├─→ Check memory flush needed
            │   └─→ If yes → Save memories
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
