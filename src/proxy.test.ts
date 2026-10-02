import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { createSessionToken, SESSION_COOKIE } from "./lib/session";

const req = (path: string, token?: string) =>
  new NextRequest(`http://localhost:3000${path}`, token ? { headers: { cookie: `${SESSION_COOKIE}=${token}` } } : undefined);

let token: string;
beforeEach(async () => {
  token = await createSessionToken();
});

describe("proxy", () => {
  it("lets login and health through without a session", async () => {
    for (const p of ["/login", "/login/x", "/api/health"]) {
      const res = await proxy(req(p));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("lets a valid session through", async () => {
    for (const p of ["/ideas", "/api/export"]) {
      const res = await proxy(req(p, token));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("redirects pages to /login with ?next=", async () => {
    const res = await proxy(req("/ideas?status=taken&x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/ideas?status=taken&x=1");
  });

  it("omits ?next= for the home page", async () => {
    const loc = new URL((await proxy(req("/"))).headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.search).toBe("");
  });

  it("treats a bad token like no token", async () => {
    expect((await proxy(req("/ideas", "garbage"))).status).toBe(307);
  });

  it("answers 401 JSON for /api without a session", async () => {
    const res = await proxy(req("/api/export"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
