/** Only allow same-origin path redirects after auth: "/home", "/p/x…".
 * Anything absolute, protocol-relative ("//evil.com"), or empty falls
 * back to "/home". */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/home";
  return next;
}
