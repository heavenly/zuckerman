import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Calendar as CalendarIcon } from "lucide-react";

interface CalendarEvent {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
  recurrence?: {
    type: "none" | "daily" | "weekly" | "monthly" | "yearly" | "cron";
    interval?: number;
    endDate?: number;
    count?: number;
    cronExpression?: string;
    timezone?: string;
  };
  enabled: boolean;
  lastTriggeredAt?: number;
  nextOccurrenceAt?: number;
}

interface CalendarViewProps {
  onClose?: () => void;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatRecurrence(recurrence?: CalendarEvent["recurrence"]): string {
  if (!recurrence || recurrence.type === "none") {
    return "";
  }

  if (recurrence.type === "cron") {
    return `(cron: ${recurrence.cronExpression})`;
  }

  const interval = recurrence.interval && recurrence.interval > 1 
    ? `every ${recurrence.interval} ` 
    : "";
  
  return `(recurring ${interval}${recurrence.type})`;
}

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();
  
  for (const event of events) {
    if (!event.nextOccurrenceAt) continue;
    
    const dateKey = formatDate(event.nextOccurrenceAt);
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push(event);
  }
  
  return grouped;
}

export function CalendarView({ onClose }: CalendarViewProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = async () => {
    if (!window.electronAPI || !window.electronAPI.getCalendarEvents) {
      setError("Calendar feature requires the Electron app.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.getCalendarEvents();
      if (result.error) {
        setError(result.error);
      } else {
        // Filter to upcoming events and sort
        const upcoming = (result.events || [])
          .filter((e: CalendarEvent) => 
            e.enabled && e.nextOccurrenceAt && e.nextOccurrenceAt > Date.now()
          )
          .sort((a: CalendarEvent, b: CalendarEvent) => {
            const aNext = a.nextOccurrenceAt || 0;
            const bNext = b.nextOccurrenceAt || 0;
            return aNext - bNext;
          });
        setEvents(upcoming);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      if (window.electronAPI?.getCalendarEvents) {
        loadEvents();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const grouped = groupEventsByDate(events);
  const sortedDates = Array.from(grouped.keys()).sort((a, b) => {
    const aDate = new Date(a).getTime();
    const bDate = new Date(b).getTime();
    return aDate - bDate;
  });

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <CalendarIcon className="h-6 w-6" />
                Calendar
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Upcoming events scheduled by agents
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadEvents}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {error && (
            <Card className="border-destructive">
              <CardContent className="pt-6">
                <p className="text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          )}

          {loading && events.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Loading events...</p>
              </CardContent>
            </Card>
          ) : events.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">No upcoming events</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {sortedDates.map((dateKey) => {
                const dateEvents = grouped.get(dateKey)!;
                
                let dateLabel = dateKey;
                if (dateKey === formatDate(today.getTime())) {
                  dateLabel = "Today";
                } else if (dateKey === formatDate(tomorrow.getTime())) {
                  dateLabel = "Tomorrow";
                }

                return (
                  <Card key={dateKey}>
                    <CardHeader>
                      <CardTitle className="text-lg">{dateLabel}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dateEvents.map((event) => {
                          const time = event.nextOccurrenceAt 
                            ? formatTime(event.nextOccurrenceAt)
                            : "TBD";
                          const recurrence = formatRecurrence(event.recurrence);
                          
                          return (
                            <div
                              key={event.id}
                              className="flex items-start gap-3 p-3 rounded-md hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{time}</span>
                                  <span className="text-sm text-foreground">{event.title}</span>
                                </div>
                                {recurrence && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {recurrence}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
