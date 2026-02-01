import { Cron } from "croner";
import type { SecurityContext } from "@world/execution/security/types.js";
import { isToolAllowed } from "@world/execution/security/policy/tool-policy.js";
import type { Tool, ToolDefinition, ToolResult } from "../terminal/index.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CALENDAR_DIR = join(homedir(), ".zuckerman", "calendar");
const EVENTS_FILE = join(CALENDAR_DIR, "events.json");
const OLD_CRON_DIR = join(homedir(), ".zuckerman", "cron");
const OLD_JOBS_FILE = join(OLD_CRON_DIR, "jobs.json");

interface RecurrenceRule {
  type: "none" | "daily" | "weekly" | "monthly" | "yearly" | "cron";
  interval?: number;
  endDate?: number;
  count?: number;
  cronExpression?: string;
  timezone?: string;
}

interface EventAction {
  type: "agentTurn" | "systemEvent";
  message?: string;
  text?: string;
  sessionTarget: "main" | "isolated";
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
  recurrence?: RecurrenceRule;
  action: EventAction;
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
  nextOccurrenceAt?: number;
}

// Legacy interface for migration
interface LegacyCronJob {
  id: string;
  name?: string;
  schedule: {
    kind: "at" | "every" | "cron";
    atMs?: number;
    everyMs?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: "systemEvent" | "agentTurn";
    text?: string;
    message?: string;
  };
  sessionTarget: "main" | "isolated";
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

let events = new Map<string, CalendarEvent>();
let cronInstances = new Map<string, Cron>();

// Migrate legacy cron job to calendar event
function migrateLegacyJob(job: LegacyCronJob): CalendarEvent {
  let recurrence: RecurrenceRule | undefined;
  let startTime = Date.now();
  let nextOccurrenceAt: number | undefined;

  if (job.schedule.kind === "at") {
    startTime = job.schedule.atMs || Date.now();
    nextOccurrenceAt = job.nextRunAt || startTime;
    recurrence = { type: "none" };
  } else if (job.schedule.kind === "every") {
    const everyMs = job.schedule.everyMs || 60000;
    startTime = Date.now();
    nextOccurrenceAt = Date.now() + everyMs;
    recurrence = {
      type: "cron",
      cronExpression: `*/${Math.floor(everyMs / 1000)} * * * * *`,
      timezone: job.schedule.tz,
    };
  } else if (job.schedule.kind === "cron") {
    startTime = Date.now();
    recurrence = {
      type: "cron",
      cronExpression: job.schedule.expr || "0 * * * *",
      timezone: job.schedule.tz,
    };
  }

  return {
    id: job.id,
    title: job.name || "Untitled Event",
    startTime,
    recurrence,
    action: {
      type: job.payload.kind === "agentTurn" ? "agentTurn" : "systemEvent",
      message: job.payload.message,
      text: job.payload.text,
      sessionTarget: job.sessionTarget,
    },
    enabled: job.enabled,
    createdAt: Date.now(),
    lastTriggeredAt: job.lastRunAt,
    nextOccurrenceAt: nextOccurrenceAt || job.nextRunAt,
  };
}

// Calculate next occurrence for recurring events
function calculateNextOccurrence(event: CalendarEvent): number | undefined {
  if (!event.recurrence || event.recurrence.type === "none") {
    return event.startTime > Date.now() ? event.startTime : undefined;
  }

  if (event.recurrence.type === "cron" && event.recurrence.cronExpression) {
    try {
      const cron = new Cron(event.recurrence.cronExpression, {
        timezone: event.recurrence.timezone,
      });
      const next = cron.nextRun();
      return next ? next.getTime() : undefined;
    } catch {
      return undefined;
    }
  }

  // For daily/weekly/monthly/yearly, calculate based on interval
  const now = Date.now();
  const interval = event.recurrence.interval || 1;
  let next = event.nextOccurrenceAt || event.startTime;

  if (event.recurrence.type === "daily") {
    const dayMs = 24 * 60 * 60 * 1000;
    while (next <= now) {
      next += dayMs * interval;
    }
  } else if (event.recurrence.type === "weekly") {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    while (next <= now) {
      next += weekMs * interval;
    }
  } else if (event.recurrence.type === "monthly") {
    // Approximate month as 30 days
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    while (next <= now) {
      next += monthMs * interval;
    }
  } else if (event.recurrence.type === "yearly") {
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    while (next <= now) {
      next += yearMs * interval;
    }
  }

  // Check end date and count limits
  if (event.recurrence.endDate && next > event.recurrence.endDate) {
    return undefined;
  }

  return next;
}

// Load events from disk
function loadEvents(): void {
  if (!existsSync(CALENDAR_DIR)) {
    mkdirSync(CALENDAR_DIR, { recursive: true });
  }

  // Migrate old cron jobs if they exist
  if (existsSync(OLD_JOBS_FILE) && !existsSync(EVENTS_FILE)) {
    try {
      const data = readFileSync(OLD_JOBS_FILE, "utf-8");
      const jobsArray = JSON.parse(data) as LegacyCronJob[];
      const migratedEvents = jobsArray.map(job => migrateLegacyJob(job));
      events.clear();
      for (const event of migratedEvents) {
        events.set(event.id, event);
      }
      saveEvents();
      console.log(`[Calendar] Migrated ${jobsArray.length} legacy cron jobs to calendar events`);
    } catch (error) {
      console.error("[Calendar] Failed to migrate legacy jobs:", error);
    }
  }

  if (existsSync(EVENTS_FILE)) {
    try {
      const data = readFileSync(EVENTS_FILE, "utf-8");
      const eventsArray = JSON.parse(data) as CalendarEvent[];
      events.clear();
      for (const event of eventsArray) {
        events.set(event.id, event);
      }
      scheduleEvents();
    } catch (error) {
      console.error("[Calendar] Failed to load events:", error);
    }
  }
}

// Save events to disk
function saveEvents(): void {
  if (!existsSync(CALENDAR_DIR)) {
    mkdirSync(CALENDAR_DIR, { recursive: true });
  }

  try {
    const eventsArray = Array.from(events.values());
    writeFileSync(EVENTS_FILE, JSON.stringify(eventsArray, null, 2), "utf-8");
  } catch (error) {
    console.error("[Calendar] Failed to save events:", error);
  }
}

// Schedule an event
function scheduleEvent(event: CalendarEvent): void {
  // Stop existing cron if any
  const existing = cronInstances.get(event.id);
  if (existing) {
    existing.stop();
  }

  if (!event.enabled) {
    return;
  }

  const nextOccurrence = calculateNextOccurrence(event);
  if (!nextOccurrence) {
    return;
  }

  event.nextOccurrenceAt = nextOccurrence;

  // For one-time events, use setTimeout
  if (!event.recurrence || event.recurrence.type === "none") {
    const delay = Math.max(0, nextOccurrence - Date.now());
    setTimeout(() => {
      executeEvent(event);
    }, delay);
    return;
  }

  // For recurring events, use Cron
  if (event.recurrence.type === "cron" && event.recurrence.cronExpression) {
    const cron = new Cron(event.recurrence.cronExpression, {
      timezone: event.recurrence.timezone,
    }, () => {
      executeEvent(event);
      // Update next occurrence
      event.nextOccurrenceAt = calculateNextOccurrence(event);
      saveEvents();
    });
    cronInstances.set(event.id, cron);
  } else {
    // For daily/weekly/monthly/yearly, calculate interval and use cron
    const now = Date.now();
    const delay = Math.max(0, nextOccurrence - now);
    
    setTimeout(() => {
      executeEvent(event);
      // Schedule next occurrence
      event.nextOccurrenceAt = calculateNextOccurrence(event);
      if (event.nextOccurrenceAt) {
        scheduleEvent(event);
      }
      saveEvents();
    }, delay);
  }

  saveEvents();
}

// Schedule all events
function scheduleEvents(): void {
  for (const event of events.values()) {
    scheduleEvent(event);
  }
}

// Execute an event
async function executeEvent(event: CalendarEvent): Promise<void> {
  console.log(`[Calendar] Executing event: ${event.id} - ${event.title}`);
  event.lastTriggeredAt = Date.now();

  // TODO: Actually execute the event action
  // For now, just log it
  if (event.action.type === "systemEvent") {
    console.log(`[Calendar] System event: ${event.action.text}`);
  } else if (event.action.type === "agentTurn") {
    console.log(`[Calendar] Agent turn: ${event.action.message}`);
  }

  // Update next occurrence for recurring events
  if (event.recurrence && event.recurrence.type !== "none") {
    event.nextOccurrenceAt = calculateNextOccurrence(event);
    if (event.nextOccurrenceAt) {
      scheduleEvent(event);
    }
  }

  saveEvents();
}

// Initialize on module load
loadEvents();

export function createCronTool(): Tool {
  return {
    definition: {
      name: "cron",
      description: "Manage calendar events and scheduled tasks. Create, list, update, remove, and trigger calendar events.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Action: status, list, create, get, update, delete, trigger. For backward compatibility: add, remove, run (maps to create, delete, trigger)",
          },
          eventId: {
            type: "string",
            description: "Event ID (for get, update, delete, trigger actions). Also accepts 'jobId' for backward compatibility",
          },
          jobId: {
            type: "string",
            description: "Legacy job ID (maps to eventId)",
          },
          event: {
            type: "object",
            description: "Event object (for create action). Also accepts 'job' for backward compatibility",
          },
          job: {
            type: "object",
            description: "Legacy job object (maps to event)",
          },
          patch: {
            type: "object",
            description: "Patch object (for update action)",
          },
          upcoming: {
            type: "boolean",
            description: "Filter to show only upcoming events (for list action, default: true)",
          },
          from: {
            type: "number",
            description: "Start timestamp filter (for list action)",
          },
          to: {
            type: "number",
            description: "End timestamp filter (for list action)",
          },
        },
        required: ["action"],
      },
    },
    handler: async (params, securityContext) => {
      try {
        let { action } = params;

        // Backward compatibility: map old actions
        if (action === "add") action = "create";
        if (action === "remove") action = "delete";
        if (action === "run") action = "trigger";

        if (typeof action !== "string") {
          return {
            success: false,
            error: "action must be a string",
          };
        }

        // Check tool security
        if (securityContext) {
          const toolAllowed = isToolAllowed("cron", securityContext.toolPolicy);
          if (!toolAllowed) {
            return {
              success: false,
              error: "Calendar tool is not allowed by security policy",
            };
          }
        }

        // Handle backward compatibility for jobId
        const eventId = params.eventId || params.jobId;

        switch (action) {
          case "status": {
            const upcoming = Array.from(events.values())
              .filter(e => e.enabled && e.nextOccurrenceAt && e.nextOccurrenceAt > Date.now())
              .length;
            return {
              success: true,
              result: {
                enabled: true,
                eventsCount: events.size,
                activeEvents: Array.from(events.values()).filter(e => e.enabled).length,
                upcomingEvents: upcoming,
              },
            };
          }

          case "list": {
            let eventsList = Array.from(events.values());
            
            const upcoming = params.upcoming !== false;
            if (upcoming) {
              eventsList = eventsList.filter(e => 
                e.nextOccurrenceAt && e.nextOccurrenceAt > Date.now()
              );
            }

            if (params.from) {
              eventsList = eventsList.filter(e => 
                e.nextOccurrenceAt && e.nextOccurrenceAt >= (params.from as number)
              );
            }

            if (params.to) {
              eventsList = eventsList.filter(e => 
                e.nextOccurrenceAt && e.nextOccurrenceAt <= (params.to as number)
              );
            }

            // Sort by next occurrence
            eventsList.sort((a, b) => {
              const aNext = a.nextOccurrenceAt || 0;
              const bNext = b.nextOccurrenceAt || 0;
              return aNext - bNext;
            });

            const eventsData = eventsList.map(event => ({
              id: event.id,
              title: event.title,
              startTime: event.startTime,
              endTime: event.endTime,
              recurrence: event.recurrence,
              enabled: event.enabled,
              lastTriggeredAt: event.lastTriggeredAt,
              nextOccurrenceAt: event.nextOccurrenceAt,
            }));

            return {
              success: true,
              result: { events: eventsData },
            };
          }

          case "create": {
            const eventData = (params.event || params.job) as Partial<CalendarEvent>;
            if (!eventData || !eventData.startTime || !eventData.action) {
              return {
                success: false,
                error: "event object must include startTime and action",
              };
            }

            const eventId = eventData.id || `event-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const event: CalendarEvent = {
              id: eventId,
              title: eventData.title || "Untitled Event",
              startTime: eventData.startTime,
              endTime: eventData.endTime,
              recurrence: eventData.recurrence || { type: "none" },
              action: eventData.action,
              enabled: eventData.enabled !== false,
              createdAt: Date.now(),
            };

            events.set(eventId, event);
            scheduleEvent(event);
            saveEvents();

            return {
              success: true,
              result: { eventId, event },
            };
          }

          case "get": {
            if (!eventId) {
              return {
                success: false,
                error: "eventId is required for get action",
              };
            }

            const event = events.get(eventId);
            if (!event) {
              return {
                success: false,
                error: `Event ${eventId} not found`,
              };
            }

            return {
              success: true,
              result: { event },
            };
          }

          case "update": {
            if (!eventId) {
              return {
                success: false,
                error: "eventId is required for update action",
              };
            }

            const patch = params.patch as Partial<CalendarEvent> | undefined;
            if (!patch) {
              return {
                success: false,
                error: "patch is required for update action",
              };
            }

            const event = events.get(eventId);
            if (!event) {
              return {
                success: false,
                error: `Event ${eventId} not found`,
              };
            }

            // Apply patch
            Object.assign(event, patch);
            scheduleEvent(event);
            saveEvents();

            return {
              success: true,
              result: { eventId, event },
            };
          }

          case "delete": {
            if (!eventId) {
              return {
                success: false,
                error: "eventId is required for delete action",
              };
            }

            const event = events.get(eventId);
            if (!event) {
              return {
                success: false,
                error: `Event ${eventId} not found`,
              };
            }

            // Stop cron instance
            const cron = cronInstances.get(eventId);
            if (cron) {
              cron.stop();
              cronInstances.delete(eventId);
            }

            events.delete(eventId);
            saveEvents();

            return {
              success: true,
              result: { eventId },
            };
          }

          case "trigger": {
            if (!eventId) {
              return {
                success: false,
                error: "eventId is required for trigger action",
              };
            }

            const event = events.get(eventId);
            if (!event) {
              return {
                success: false,
                error: `Event ${eventId} not found`,
              };
            }

            await executeEvent(event);

            return {
              success: true,
              result: { eventId, triggered: true },
            };
          }

          default:
            return {
              success: false,
              error: `Unknown action: ${action}. Supported: status, list, create, get, update, delete, trigger`,
            };
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  };
}

// Export for CLI use
export function getAllEvents(): CalendarEvent[] {
  return Array.from(events.values());
}

export function getUpcomingEvents(limit?: number): CalendarEvent[] {
  const upcoming = Array.from(events.values())
    .filter(e => e.enabled && e.nextOccurrenceAt && e.nextOccurrenceAt > Date.now())
    .sort((a, b) => (a.nextOccurrenceAt || 0) - (b.nextOccurrenceAt || 0));
  
  return limit ? upcoming.slice(0, limit) : upcoming;
}
