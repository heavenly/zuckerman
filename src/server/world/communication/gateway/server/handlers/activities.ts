import type { GatewayRequestHandlers } from "../types.js";
import { queryActivities, getActivityCount, getAvailableDateRange } from "@server/agents/zuckerman/activity/index.js";
import type { ActivityQuery } from "@server/agents/zuckerman/activity/types.js";

export function createActivityHandlers(): Partial<GatewayRequestHandlers> {
  return {
    "activities.list": async ({ respond, params }) => {
      try {
        const query: ActivityQuery = {
          from: params?.from as number | undefined,
          to: params?.to as number | undefined,
          agentId: params?.agentId as string | undefined,
          conversationId: params?.conversationId as string | undefined,
          type: params?.type as ActivityQuery["type"],
          limit: params?.limit as number | undefined,
          offset: params?.offset as number | undefined,
        };

        const activities = queryActivities(query);
        const count = getActivityCount(query);

        respond(true, {
          activities,
          count,
          query,
        });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to list activities",
        });
      }
    },

    "activities.count": async ({ respond, params }) => {
      try {
        const query: ActivityQuery = {
          from: params?.from as number | undefined,
          to: params?.to as number | undefined,
          agentId: params?.agentId as string | undefined,
          conversationId: params?.conversationId as string | undefined,
          type: params?.type as ActivityQuery["type"],
        };

        const count = getActivityCount(query);

        respond(true, { count, query });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to get activity count",
        });
      }
    },

    "activities.range": async ({ respond }) => {
      try {
        const range = getAvailableDateRange();

        respond(true, { range });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to get date range",
        });
      }
    },
  };
}
