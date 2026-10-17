import { AgentHabitError } from "@agenthabit/core";
import { z } from "zod";

/**
 * What the API needs on top of the chain settings (T5). Validated once at start-up; the error
 * names the variables only, never their values, which are secrets.
 */
const nonEmpty = z.string().trim().min(1);

/** 32 random bytes in base64: `openssl rand -base64 32`. */
const TokenEncryptionKeySchema = z
  .string()
  .refine(
    (value) =>
      Buffer.from(value, "base64").length === 32 &&
      Buffer.from(value, "base64").toString("base64") === value,
  );

export const ApiEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  TOKEN_ENCRYPTION_KEY: TokenEncryptionKeySchema,
  STRAVA_CLIENT_ID: nonEmpty,
  STRAVA_CLIENT_SECRET: nonEmpty,
  STRAVA_REDIRECT_URI: z.url({ protocol: /^https?$/ }),
  STRAVA_API_BASE_URL: z.url({ protocol: /^https$/ }).default("https://www.strava.com/api/v3"),
  STRAVA_OAUTH_BASE_URL: z.url({ protocol: /^https$/ }).default("https://www.strava.com/oauth"),
  /** The web's origin: the link message names it, and the OAuth callback returns to it. */
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:5173"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** `KEY=` in a dotenv file means "not set yet", exactly like a missing line. */
function withoutEmpty(source: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
}

export function parseApiEnv(source: Readonly<Record<string, string | undefined>>): ApiEnv {
  const result = ApiEnvSchema.safeParse(withoutEmpty(source));
  if (result.success) return result.data;
  const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new AgentHabitError("ConfigError", `invalid API environment: ${variables.join(", ")}`, {
    details: { variables },
  });
}
