/**
 * The Content-Security-Policy of the built site (T7a). Everything is self-hosted, so the only
 * origins the page may talk to are itself and the API. The wallet extension needs nothing from
 * here: Freighter answers through `window.postMessage`, which a CSP does not govern.
 *
 * `frame-ancestors` is ignored inside a `<meta>` tag, so it only goes in the headers variant.
 */
export interface ContentSecurityPolicy {
  /** For a `<meta http-equiv>` tag. */
  readonly meta: string;
  /** For a real HTTP header (`_headers` file or the host's header settings). */
  readonly header: string;
}

export function contentSecurityPolicy(apiUrl: string): ContentSecurityPolicy {
  const apiOrigin = new URL(apiUrl).origin;
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ];
  return {
    meta: directives.join("; "),
    header: [...directives, "frame-ancestors 'none'"].join("; "),
  };
}
