import { parseApiUrl } from "./api-url.js";

/** The API base URL from `VITE_API_URL` (see `parseApiUrl` for the production rules). */
export function apiBaseUrl(
  raw: string | undefined = import.meta.env.VITE_API_URL,
  production: boolean = import.meta.env.PROD,
): string {
  return parseApiUrl(raw, production);
}
