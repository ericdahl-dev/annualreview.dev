/**
 * Generates a unique ID with a given prefix.
 * Format: `{prefix}_{timestamp}_{random}`
 * Random suffix is 9 base-36 characters (~78 billion possible values per millisecond).
 */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
