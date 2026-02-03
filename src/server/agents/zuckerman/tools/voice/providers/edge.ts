/**
 * Edge Text-to-Speech Provider
 * 
 * Generates speech audio using Microsoft Edge's online neural text-to-speech service.
 * This is a free service that doesn't require an API key.
 */

export interface EdgeTextToSpeechOptions {
  voice?: string;
  lang?: string;
  outputFormat?: string;
  pitch?: string;
  rate?: string;
  volume?: string;
}

export interface EdgeTextToSpeechResult {
  success: boolean;
  audioBuffer?: Buffer;
  error?: string;
  latencyMs?: number;
}

const DEFAULT_EDGE_VOICE = "en-US-MichelleNeural";
const DEFAULT_EDGE_LANG = "en-US";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

// Lazy load edge-tts to avoid requiring it as a hard dependency
let EdgeTTS: typeof import("node-edge-tts").EdgeTTS | null = null;

async function getEdgeTTS() {
  if (!EdgeTTS) {
    try {
      const edgeTtsModule = await import("node-edge-tts");
      EdgeTTS = edgeTtsModule.EdgeTTS;
    } catch (error) {
      throw new Error(
        "node-edge-tts not installed. Install it with: npm install node-edge-tts",
      );
    }
  }
  return EdgeTTS;
}

export async function edgeTextToSpeech(
  text: string,
  options: EdgeTextToSpeechOptions = {},
): Promise<EdgeTextToSpeechResult> {
  const startTime = Date.now();
  
  try {
    const EdgeTTSClass = await getEdgeTTS();
    const tts = new EdgeTTSClass();
    
    const voice = options.voice || DEFAULT_EDGE_VOICE;
    const lang = options.lang || DEFAULT_EDGE_LANG;
    const outputFormat = options.outputFormat || DEFAULT_OUTPUT_FORMAT;

    // Build SSML if pitch/rate/volume are specified
    let ssmlText = text;
    if (options.pitch || options.rate || options.volume) {
      const pitch = options.pitch || "+0Hz";
      const rate = options.rate || "+0%";
      const volume = options.volume || "+0%";
      ssmlText = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
        <voice name="${voice}">
          <prosody pitch="${pitch}" rate="${rate}" volume="${volume}">
            ${text}
          </prosody>
        </voice>
      </speak>`;
    }

    // Use the EdgeTTS API (methods may vary by version)
    const audioBuffer = await (tts as any).toBuffer?.({
      text: ssmlText,
      voice,
      outputFormat,
    }) || await (tts as any).synthesize?.({
      text: ssmlText,
      voice,
      outputFormat,
    });
    
    if (!audioBuffer) {
      throw new Error("EdgeTTS API method not available");
    }
    
    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      audioBuffer: buffer,
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get list of available Edge text-to-speech voices
 */
export async function getEdgeVoices(): Promise<Array<{ name: string; locale: string; gender: string }>> {
  try {
    const edgeTtsModule = await import("node-edge-tts");
    // Try different possible API patterns
    const listVoices = (edgeTtsModule as any).listVoices || 
                       (edgeTtsModule.default as any)?.listVoices ||
                       (edgeTtsModule.EdgeTTS as any)?.listVoices;
    
    if (typeof listVoices === "function") {
      return await listVoices();
    }
    // Fallback: return default voice
    return [{
      name: DEFAULT_EDGE_VOICE,
      locale: DEFAULT_EDGE_LANG,
      gender: "Female",
    }];
  } catch (error) {
    console.error("Failed to list Edge text-to-speech voices:", error);
    return [];
  }
}
