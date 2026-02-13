/**
 * Generate a unique conversation ID
 * Format: base36 timestamp (6 chars) + random base36 (4 chars) = 10 chars total
 * Example: "lxj2k9a3b1"
 */
export function generateShortID(): string {
  const timestamp = Date.now().toString(36).slice(-6); // Last 6 chars of base36 timestamp
  const random = Math.random().toString(36).substring(2, 6); // 4 random base36 chars
  return `${timestamp}${random}`;
}
