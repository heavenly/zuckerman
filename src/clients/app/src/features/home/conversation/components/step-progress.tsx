import React from "react";
import { CheckCircle2, Circle, AlertCircle, Loader2, AlertTriangle } from "lucide-react";
import type { TaskStep } from "../../../../../types/message";

interface StepProgressProps {
  steps: TaskStep[];
  currentStep?: TaskStep;
  progress?: number;
  confirmationRequired?: boolean;
  fallbackTask?: {
    id: string;
    title: string;
  };
}

export function StepProgress({
  steps,
  currentStep,
  progress = 0,
  confirmationRequired,
  fallbackTask,
}: StepProgressProps) {
  if (!steps || steps.length === 0) {
    return null;
  }

  const sortedSteps = [...steps].sort((a, b) => a.order - b.order);

  return (
    <div className="mt-4 space-y-3">
      {/* Progress bar */}
      {progress !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Task Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Confirmation required alert */}
      {confirmationRequired && currentStep && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              Confirmation Required
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {currentStep.confirmationReason || `Step "${currentStep.title}" requires your approval before execution.`}
            </div>
          </div>
        </div>
      )}

      {/* Fallback task alert */}
      {fallbackTask && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
          <AlertCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
              Fallback Plan Activated
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {fallbackTask.title}
            </div>
          </div>
        </div>
      )}

      {/* Steps list */}
      <div className="space-y-2">
        {sortedSteps.map((step, index) => {
          const isCurrent = currentStep?.id === step.id;
          const isCompleted = step.completed || (currentStep && step.order < currentStep.order);
          const hasError = step.error;

          return (
            <div
              key={step.id}
              className={`flex items-start gap-3 p-2 rounded-md transition-colors ${
                isCurrent
                  ? "bg-primary/5 border border-primary/20"
                  : hasError
                  ? "bg-destructive/5 border border-destructive/20"
                  : "bg-muted/30"
              }`}
            >
              {/* Step icon */}
              <div className="shrink-0 mt-0.5">
                {hasError ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : isCompleted ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : isCurrent ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${
                      isCurrent
                        ? "text-primary"
                        : hasError
                        ? "text-destructive"
                        : isCompleted
                        ? "text-green-600 dark:text-green-400"
                        : "text-foreground"
                    }`}
                  >
                    {step.title}
                  </span>
                  {step.requiresConfirmation && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
                      Requires Approval
                    </span>
                  )}
                </div>
                {step.description && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {step.description}
                  </div>
                )}
                {hasError && (
                  <div className="text-xs text-destructive mt-1">
                    Error: {step.error}
                  </div>
                )}
              </div>

              {/* Step number */}
              <div className="shrink-0 text-xs text-muted-foreground">
                {step.order + 1}/{sortedSteps.length}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
