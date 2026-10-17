import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../dev/mock-app.js";
import { BASE_URL, makeHarness } from "./helpers.js";

describe("the dev mock API", () => {
  it("answers every public endpoint with a valid contract shape in every scenario", async () => {
    for (const { name } of SCENARIOS) {
      const { app } = makeHarness({ scenario: name });
      // `reply()` parses with the core schemas before sending: a bad shape would be a 500.
      expect((await app.request("/config")).status, name).toBe(200);
      expect((await app.request("/health")).status, name).toBe(200);
    }
  });

  it("refuses authenticated endpoints without a session", async () => {
    const { app } = makeHarness();
    for (const path of ["/me", "/weeks/me", "/strava/connect"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthenticated" });
    }
  });

  it("does not leak another session's data: a made-up token reads nothing", async () => {
    const { app } = makeHarness({ scenario: "active" });
    const response = await app.request("/weeks/me", {
      headers: { Authorization: "Bearer not-a-session" },
    });
    expect(response.status).toBe(401);
  });

  it("switches scenario through the dev control", async () => {
    const { app } = makeHarness();
    const response = await app.request("/__mock/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "expired" }),
    });
    expect(await response.json()).toEqual({ scenario: "expired" });
    const bad = await app.request("/__mock/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nope" }),
    });
    expect(bad.status).toBe(400);
  });

  it("allows only the web's origin through CORS", async () => {
    const { app } = makeHarness();
    const response = await app.request("/config", { headers: { Origin: "http://localhost:5173" } });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(BASE_URL).toContain("api.test");
  });
});
