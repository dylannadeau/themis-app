/**
 * Shared utility functions used across API routes.
 */

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cleanJsonResponse(text: string): string {
  return text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
}
