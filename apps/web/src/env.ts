import { z } from "zod";

const DEFAULT_API_URL = "http://localhost:3000";

const ApiUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"));

/** The API base URL from `VITE_API_URL`, without a trailing slash. */
export function apiBaseUrl(raw: string | undefined = import.meta.env.VITE_API_URL): string {
  const parsed = ApiUrlSchema.safeParse(raw === undefined || raw === "" ? DEFAULT_API_URL : raw);
  const url = parsed.success ? parsed.data : DEFAULT_API_URL;
  return url.replace(/\/+$/, "");
}
