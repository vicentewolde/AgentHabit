// The Strava client: OAuth, token rotation and the week's reading (spec 4.5, strava.md).
export {
  type Connection,
  DEFAULT_API_BASE_URL,
  DEFAULT_OAUTH_BASE_URL,
  StravaClient,
  type StravaClientOptions,
  type Tokens,
  type WeekReading,
} from "./client.js";
export { isExhausted, parseReadLimit, type ReadLimit } from "./rate-limit.js";
export { REQUIRED_SCOPE, scopeList } from "./schemas.js";
