# Browser Tool

Professional browser automation tool with comprehensive features for web interaction, testing, and automation.

## Architecture

The browser tool is organized into clean, modular components:

```
browser/
├── tool.ts                 # Main tool entry point
├── browser-manager.ts      # Browser lifecycle & tab management
├── types.ts                # Type definitions
├── utils.ts                # Utility functions
├── actions/                # Action handlers
│   ├── index.ts           # Action dispatcher
│   ├── click.ts           # Click handler
│   ├── type.ts            # Type handler
│   ├── press.ts           # Keyboard press
│   ├── hover.ts           # Hover handler
│   ├── scroll.ts          # Scroll handler
│   ├── drag.ts            # Drag & drop
│   ├── select.ts          # Dropdown selection
│   ├── fill.ts            # Form filling
│   ├── resize.ts          # Viewport resize
│   ├── wait.ts            # Wait conditions
│   └── evaluate.ts        # JavaScript evaluation
├── snapshot/              # Snapshot system
│   ├── extractor.ts       # Snapshot extraction logic
│   └── snapshot.ts        # Snapshot handler
├── storage/               # Cookies & storage
│   └── index.ts           # Storage operations
├── emulation/             # Browser emulation
│   └── index.ts           # Emulation features
├── debug/                 # Debugging tools
│   └── index.ts           # Debug operations
└── files/                 # File operations
    └── index.ts           # File handling
```

## Features

### Core Actions
- **Navigate** - Navigate to URLs
- **Snapshot** - AI/ARIA page snapshots with ref-based element identification
- **Screenshot** - Full page or element screenshots
- **Tab Management** - List, open, focus, close tabs

### User Interactions
- **Click** - Single/double click with modifiers
- **Type** - Text input with submit/slow typing options
- **Press** - Keyboard key presses
- **Hover** - Mouse hover
- **Scroll** - Scroll element into view
- **Drag** - Drag and drop
- **Select** - Dropdown selection
- **Fill** - Multi-field form filling
- **Resize** - Viewport resizing
- **Wait** - Wait for conditions (text, selector, URL, load state, custom function)
- **Evaluate** - Execute JavaScript

### Storage & Cookies
- Get/set/clear cookies
- localStorage operations
- sessionStorage operations

### Browser Emulation
- Offline mode
- Custom HTTP headers
- HTTP authentication
- Geolocation
- Media features (color scheme)
- Timezone
- Locale
- Device emulation (iPhone, Pixel, etc.)

### Debugging
- Console messages
- JavaScript errors
- Network requests

### File Operations
- File uploads
- Dialog handling (alert/confirm/prompt)
- File downloads
- Response body retrieval
- Element highlighting

## Usage Examples

### Basic Navigation
```typescript
{
  action: "navigate",
  url: "https://example.com"
}
```

### Take Snapshot
```typescript
{
  action: "snapshot",
  format: "ai",
  interactive: true,
  maxChars: 200
}
```

### Click Element by Ref
```typescript
{
  action: "act",
  request: {
    kind: "click",
    ref: "e12",
    doubleClick: false,
    modifiers: ["Control"]
  }
}
```

### Fill Form
```typescript
{
  action: "act",
  request: {
    kind: "fill",
    fields: [
      { ref: "e5", type: "text", value: "John Doe" },
      { ref: "e6", type: "email", value: "john@example.com" },
      { ref: "e7", type: "checkbox", value: true }
    ]
  }
}
```

### Tab Management
```typescript
// List tabs
{ action: "tabs", tabAction: "list" }

// Open new tab
{ action: "tabs", tabAction: "open", url: "https://example.com" }

// Focus tab
{ action: "tabs", tabAction: "focus", targetId: "tab-1" }

// Close tab
{ action: "tabs", tabAction: "close", targetId: "tab-1" }
```

### Storage Operations
```typescript
// Get cookies
{ action: "cookies" }

// Set cookie
{
  action: "cookies",
  cookie: {
    name: "session",
    value: "abc123",
    domain: "example.com"
  }
}

// Get localStorage
{ action: "storage", storageKind: "local", key: "user" }

// Set localStorage
{ action: "storage", storageKind: "local", key: "user", value: "john" }
```

## Ref-Based Element Identification

Snapshots generate stable refs (e.g., "e12") for elements. These refs are more reliable than CSS selectors because:

1. They survive DOM changes
2. They're extracted from semantic page structure
3. They work across page reloads (when combined with stable selectors)

Use refs in actions:
```typescript
{
  action: "act",
  request: {
    kind: "click",
    ref: "e12"  // From snapshot
  }
}
```

## Browser Lifecycle

The browser is managed automatically:
- Launched on first action
- Reused across calls
- Tabs are tracked and managed
- Browser stays open until explicitly closed

```typescript
// Check status
{ action: "status" }

// Stop browser
{ action: "stop" }

// Close browser
{ action: "close" }
```

## Error Handling

All actions include comprehensive error handling:
- Validation before execution
- Clear error messages
- Graceful degradation
- Browser state recovery

## Performance

- Lazy browser launch
- Tab reuse
- Efficient snapshot extraction
- File-based storage for large snapshots (prevents context overflow)

## Security

- Security policy checks
- Sandbox support ready
- Isolated browser instances
- Configurable permissions
