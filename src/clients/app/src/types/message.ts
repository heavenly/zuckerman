export interface TaskStep {
  id: string;
  title: string;
  description?: string;
  order: number;
  completed?: boolean;
  requiresConfirmation?: boolean;
  confirmationReason?: string;
  error?: string;
}

export interface Message {
  role: "user" | "assistant" | "system" | "thinking";
  content: string;
  timestamp: number;
  rawResponse?: unknown; // Store raw JSON response for viewing
  isStreaming?: boolean; // For streaming responses
  steps?: TaskStep[]; // Planning steps
  currentStep?: TaskStep; // Current active step
  stepProgress?: number; // Progress percentage (0-100)
  confirmationRequired?: boolean; // If current step requires confirmation
  fallbackTask?: {
    id: string;
    title: string;
  };
}

export interface BackendMessage {
  role: string;
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolCalls?: unknown[];
}
