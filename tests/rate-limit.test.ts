import { describe, expect, it } from "vitest";
import { checkRateLimit, clientIdFromHeaders } from "@/lib/rate-limit";

describe("clientIdFromHeaders", () => {
  it("prefers the first x-forwarded-for hop", () => {
    expect(clientIdFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIdFromHeaders(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIdFromHeaders(new Headers())).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  it("allows a burst up to the limit, then blocks with a retry hint", () => {
    const now = Date.now();
    const client = `burst-${now}`;
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(client, now).allowed).toBe(true);
    }
    const blocked = checkRateLimit(client, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("lets the window slide", () => {
    const now = Date.now();
    const client = `slide-${now}`;
    for (let i = 0; i < 20; i++) checkRateLimit(client, now);
    expect(checkRateLimit(client, now).allowed).toBe(false);
    expect(checkRateLimit(client, now + 61_000).allowed).toBe(true);
  });

  it("tracks clients independently", () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) checkRateLimit(`a-${now}`, now);
    expect(checkRateLimit(`a-${now}`, now).allowed).toBe(false);
    expect(checkRateLimit(`b-${now}`, now).allowed).toBe(true);
  });
});
