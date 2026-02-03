import type { LoadedPrompts } from "./personality-loader.js";

/**
 * Personality traits that influence agent behavior
 */
export interface PersonalityTraits {
  persistent: number;      // 0-100, affects max iterations
  patient: number;         // 0-100, affects retry delays
  curious: number;         // 0-100, affects reflection frequency
  methodical: number;      // 0-100, affects tool execution strategy
  impulsive: number;       // 0-100, affects tool filtering
  attentive: number;       // 0-100, enables queue system
  resilient: number;       // 0-100, affects error recovery
}

/**
 * Default trait values
 */
const DEFAULT_TRAITS: PersonalityTraits = {
  persistent: 50,
  patient: 50,
  curious: 50,
  methodical: 50,
  impulsive: 0,
  attentive: 0,
  resilient: 75,
};

/**
 * Extract personality traits from loaded prompts
 * Accepts either full LoadedPrompts or just the files map
 */
export function extractTraits(prompts: LoadedPrompts | { files: Map<string, string> }): PersonalityTraits {
  const traits: PersonalityTraits = { ...DEFAULT_TRAITS };
  
  // Parse traits.md
  const traitsContent = prompts.files.get("traits");
  if (traitsContent) {
    parseTraitsFile(traitsContent, traits);
  }
  
  // Parse behavior.md for behavioral patterns
  const behaviorContent = prompts.files.get("behavior");
  if (behaviorContent) {
    parseBehaviorFile(behaviorContent, traits);
  }
  
  return traits;
}

/**
 * Parse traits.md file to extract trait values
 */
function parseTraitsFile(content: string, traits: PersonalityTraits): void {
  const lowerContent = content.toLowerCase();
  
  // Map markdown traits to our trait system
  // Proactive -> persistent, attentive
  if (lowerContent.includes("proactive")) {
    traits.persistent = Math.min(100, traits.persistent + 20);
    traits.attentive = Math.min(100, traits.attentive + 15);
  }
  
  // Adaptable -> methodical (lower), impulsive (higher)
  if (lowerContent.includes("adaptable")) {
    traits.methodical = Math.max(0, traits.methodical - 10);
    traits.impulsive = Math.min(100, traits.impulsive + 10);
  }
  
  // Curious -> curious
  if (lowerContent.includes("curious")) {
    traits.curious = Math.min(100, traits.curious + 25);
  }
  
  // Resilient -> resilient
  if (lowerContent.includes("resilient")) {
    traits.resilient = Math.min(100, traits.resilient + 20);
  }
  
  // Precise -> methodical
  if (lowerContent.includes("precise")) {
    traits.methodical = Math.min(100, traits.methodical + 20);
    traits.impulsive = Math.max(0, traits.impulsive - 10);
  }
  
  // Empathetic -> patient
  if (lowerContent.includes("empathetic")) {
    traits.patient = Math.min(100, traits.patient + 20);
  }
  
  // Confident -> persistent
  if (lowerContent.includes("confident")) {
    traits.persistent = Math.min(100, traits.persistent + 15);
  }
  
  // Check for intensity indicators
  if (lowerContent.includes("very") || lowerContent.includes("highly") || lowerContent.includes("extremely")) {
    // Boost all mentioned traits
    if (lowerContent.includes("proactive")) {
      traits.persistent = Math.min(100, traits.persistent + 10);
      traits.attentive = Math.min(100, traits.attentive + 10);
    }
    if (lowerContent.includes("curious")) {
      traits.curious = Math.min(100, traits.curious + 15);
    }
    if (lowerContent.includes("resilient")) {
      traits.resilient = Math.min(100, traits.resilient + 10);
    }
  }
  
  // Check for balance indicators (moderate traits)
  if (lowerContent.includes("balance") || lowerContent.includes("situational")) {
    // Moderate extreme traits
    traits.persistent = Math.max(30, Math.min(70, traits.persistent));
    traits.curious = Math.max(30, Math.min(70, traits.curious));
    traits.methodical = Math.max(30, Math.min(70, traits.methodical));
  }
}

/**
 * Parse behavior.md file for behavioral patterns
 */
function parseBehaviorFile(content: string, traits: PersonalityTraits): void {
  const lowerContent = content.toLowerCase();
  
  // "Execute tools autonomously" -> less methodical, more impulsive
  if (lowerContent.includes("autonomous") || lowerContent.includes("without asking")) {
    traits.methodical = Math.max(0, traits.methodical - 10);
    traits.impulsive = Math.min(100, traits.impulsive + 15);
  }
  
  // "Try alternative approaches automatically" -> resilient, persistent
  if (lowerContent.includes("alternative approaches") || lowerContent.includes("automatically")) {
    traits.resilient = Math.min(100, traits.resilient + 15);
    traits.persistent = Math.min(100, traits.persistent + 10);
  }
  
  // "Retry with adjusted parameters" -> patient, resilient
  if (lowerContent.includes("retry") || lowerContent.includes("adjusted")) {
    traits.patient = Math.min(100, traits.patient + 15);
    traits.resilient = Math.min(100, traits.resilient + 10);
  }
  
  // "Complete tasks end-to-end" -> persistent, attentive
  if (lowerContent.includes("end-to-end") || lowerContent.includes("without stopping")) {
    traits.persistent = Math.min(100, traits.persistent + 15);
    traits.attentive = Math.min(100, traits.attentive + 10);
  }
  
  // "Anticipate follow-up needs" -> attentive
  if (lowerContent.includes("anticipate") || lowerContent.includes("follow-up")) {
    traits.attentive = Math.min(100, traits.attentive + 20);
  }
  
  // "Briefly explain the approach" -> methodical
  if (lowerContent.includes("explain") || lowerContent.includes("approach")) {
    traits.methodical = Math.min(100, traits.methodical + 10);
  }
}
