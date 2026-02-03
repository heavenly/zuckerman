import type { Tool } from "../../terminal/index.js";
import type { SecurityContext } from "@server/world/execution/security/types.js";
import { isToolAllowed } from "@server/world/execution/security/policy/tool-policy.js";
import { transcribeAudio } from "./index.js";

export function createSpeechToTextTool(): Tool {
  return {
    definition: {
      name: "speech_to_text",
      description: "Transcribe audio file to text. Use when the user sends an audio file or voice message that needs to be converted to text.",
      parameters: {
        type: "object",
        properties: {
          audioPath: {
            type: "string",
            description: "Path to the audio file to transcribe",
          },
          provider: {
            type: "string",
            description: "STT provider: openai, deepgram, or groq (optional, uses config default)",
            enum: ["openai", "deepgram", "groq", "whisper"],
          },
          language: {
            type: "string",
            description: "Language code (e.g., 'en', 'en-US'). Optional, provider will auto-detect if not specified.",
          },
          prompt: {
            type: "string",
            description: "Optional context prompt to help improve transcription accuracy",
          },
        },
        required: ["audioPath"],
      },
    },
    handler: async (params, securityContext) => {
      try {
        const { audioPath, provider, language, prompt } = params;

        if (typeof audioPath !== "string" || audioPath.trim().length === 0) {
          return {
            success: false,
            error: "audioPath is required and must be a non-empty string",
          };
        }

        // Check tool security
        if (securityContext) {
          const toolAllowed = isToolAllowed("speech_to_text", securityContext.toolPolicy);
          if (!toolAllowed) {
            return {
              success: false,
              error: "Speech-to-text tool is not allowed by security policy",
            };
          }
        }

        // Transcribe audio
        const result = await transcribeAudio({
          audioPath,
          provider: provider as "openai" | "deepgram" | "groq" | "whisper" | undefined,
          language: typeof language === "string" ? language : undefined,
          prompt: typeof prompt === "string" ? prompt : undefined,
        });

        if (!result.success || !result.text) {
          return {
            success: false,
            error: result.error || "Transcription failed",
          };
        }

        return {
          success: true,
          result: {
            text: result.text,
            provider: result.provider,
            latencyMs: result.latencyMs,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  };
}
