export function parseQueryInt(value: string | undefined, defaultValue: number, min: number, max?: number): number {
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  
  if (max !== undefined) {
    return Math.max(min, Math.min(parsed, max));
  }
  return Math.max(min, parsed);
}
