/**
 * Minimal in-memory sliding-window limiter for the public endpoint (PRD §18).
 * Per-instance only — good enough for a single-host deployment, and it keeps the
 * app dependency-free and stateless in every other respect.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;
const MAX_TRACKED_CLIENTS = 5_000;

const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(clientId: string, now: number = Date.now()): RateLimitResult {
  if (hits.size > MAX_TRACKED_CLIENTS) hits.clear();

  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(clientId) ?? []).filter((time) => time > cutoff);

  if (recent.length >= MAX_REQUESTS) {
    hits.set(clientId, recent);
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  hits.set(clientId, recent);
  return { allowed: true, remaining: MAX_REQUESTS - recent.length, retryAfterSeconds: 0 };
}

/** Best-effort client identity from proxy headers. */
export function clientIdFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
