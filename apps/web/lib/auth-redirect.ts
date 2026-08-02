/** Only allow same-origin path redirects after auth: "/home", "/p/x…".
 * Anything absolute, protocol-relative ("//evil.com"), or empty falls
 * back to "/home". */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/home";
  // WHATWG URL parsing (what new URL(path, base) and the browser both do)
  // treats "\" as "/" for http(s) and strips tab/CR/LF entirely, so
  // "/\evil.com" and "/\t/evil.com" resolve to an ATTACKER origin despite
  // passing the prefix checks above. Reject them outright.
  if (/[\\\t\n\r]/.test(next)) return "/home";
  return next;
}
