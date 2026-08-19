import { calculateLootSplit, validateInput, ValidationError, MAX_LOG_CHARS } from "@/lib/calculate";
import { checkRateLimit, clientIdFromHeaders } from "@/lib/rate-limit";
import { MarketApiError } from "@/lib/market";

/** Chest logs are processed and discarded — nothing is cached or stored (PRD §15). */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkRateLimit(clientIdFromHeaders(request.headers));
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_LOG_CHARS + 10_000) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const input = validateInput(body);
    const result = await calculateLootSplit(input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof MarketApiError) {
      return Response.json(
        { error: "Market data is temporarily unavailable. Please retry." },
        { status: 502 },
      );
    }
    console.error("calculate failed", error);
    return Response.json({ error: "Something went wrong while calculating the split." }, { status: 500 });
  }
}
