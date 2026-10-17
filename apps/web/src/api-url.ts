import { WebError } from "./errors.js";

const DEV_DEFAULT = "http://localhost:3000";

/**
 * The API base URL, without a trailing slash. A development build may leave it unset (localhost);
 * a production build must set it, over https: there is no silent fallback to localhost, which
 * would ship a site that talks to nothing, or to the wrong thing, with no hint why.
 */
export function parseApiUrl(raw: string | undefined, production: boolean): string {
  const unset = raw === undefined || raw === "";
  if (unset && production) {
    throw new WebError("WebConfig", "VITE_API_URL must be set for a production build");
  }
  const text = unset ? DEV_DEFAULT : raw;
  let url: URL;
  try {
    url = new URL(text);
  } catch (cause) {
    throw new WebError("WebConfig", "VITE_API_URL is not a valid URL", { cause });
  }
  if (production ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol)) {
    throw new WebError(
      "WebConfig",
      production
        ? "VITE_API_URL must be https for a production build"
        : "VITE_API_URL must be http(s)",
    );
  }
  return text.replace(/\/+$/, "");
}
