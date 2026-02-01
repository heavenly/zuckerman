import React from "react";
import { CalendarView } from "./calendar-view";

interface CalendarPageProps {
  onClose: () => void;
}

export function CalendarPage({ onClose }: CalendarPageProps) {
  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <CalendarView onClose={onClose} />
    </div>
  );
}
