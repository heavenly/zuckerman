/**
 * Agent runtime entry point
 * Re-exports the ZuckermanAwareness runtime as ZuckermanRuntime for agent discovery
 */
import { ZuckermanAwareness } from "./core/awareness/runtime.js";
export { ZuckermanAwareness as ZuckermanRuntime, ZuckermanAwareness };
export type { LoadedPrompts } from "./core/identity/identity-loader.js";

// Default export for easier discovery
export default ZuckermanAwareness;
