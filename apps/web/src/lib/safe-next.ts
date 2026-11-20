/**
 * Where to go after signing in. Only a path of this site is accepted, so a
 * crafted link cannot send the visitor to another site ("//evil.example").
 */
export function safeNextPath(value: unknown, fallback = "/pro"): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
    ? value
    : fallback;
}
