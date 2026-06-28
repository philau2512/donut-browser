/**
 * Node ID generation and validation utilities.
 * Pure functions, no side effects, deterministic, testable.
 * Base64url alphabet without padding: [A-Za-z0-9_-]
 */

const NODE_ID_REGEX = /^[A-Za-z0-9_-]{8,12}$/;

/**
 * Generate a stable short node ID (base64url, 8-12 chars).
 * Uses Web Crypto API for randomness (supported in Tauri + Next.js).
 * @returns string matching /^[A-Za-z0-9_-]{8,12}$/
 */
export function generateNodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const base64 = btoa(String.fromCharCode(...bytes));
  // Convert to base64url (replace +/ with -_, remove padding)
  const base64url = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  // Ensure 8-12 chars
  return base64url.slice(0, 10);
}

/**
 * Validate node ID format.
 * @param id - candidate string
 * @returns true if matches base64url 8-12 chars
 */
export function isValidNodeId(id: string): boolean {
  return NODE_ID_REGEX.test(id);
}
