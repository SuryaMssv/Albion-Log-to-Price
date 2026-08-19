import { describe, expect, it, vi } from "vitest";
import {
  buildHistoryUrl,
  buildRequestUrl,
  fetchPrices,
  fetchSalesHistory,
  foldRows,
  quoteKey,
  type AodpRow,
  type Fetcher,
} from "@/lib/market";

function row(overrides: Partial<AodpRow>): AodpRow {
  return {
    item_id: "T4_BAG@1",
    city: "Caerleon",
    quality: 4,
    sell_price_min: 0,
    sell_price_min_date: "0001-01-01T00:00:00",
    sell_price_max: 0,
    buy_price_max: 0,
    buy_price_max_date: "0001-01-01T00:00:00",
    ...overrides,
  };
}

function jsonFetcher(payload: unknown, status = 200): Fetcher {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as Fetcher;
}

const KEY = quoteKey("T4_BAG@1", 4);

describe("buildRequestUrl", () => {
  it("targets the requested regional API with batched ids", () => {
    expect(buildRequestUrl("east", ["T4_BAG@1", "T4_CAPE"], [4])).toBe(
      "https://east.albion-online-data.com/api/v2/stats/prices/T4_BAG%401,T4_CAPE?qualities=4",
    );
    expect(buildRequestUrl("europe", ["T4_BAG"], [1])).toContain("europe.albion-online-data.com");
  });

  it("deduplicates and sorts qualities", () => {
    expect(buildRequestUrl("west", ["T4_BAG"], [4, 1, 4])).toContain("qualities=1,4");
  });
});

describe("foldRows", () => {
  it("prices from the selected city, not the cheapest city", () => {
    const folded = foldRows(
      [
        row({ city: "Bridgewatch", sell_price_min: 9_685, sell_price_min_date: "2026-08-18T05:30:00" }),
        row({ city: "Martlock", sell_price_min: 15_490, sell_price_min_date: "2026-08-17T16:35:00" }),
        row({ city: "Caerleon", sell_price_min: 11_079, sell_price_min_date: "2026-08-17T20:35:00" }),
      ],
      "Martlock",
    );
    expect(folded.quotes.get(KEY)).toEqual({
      price: 15_490,
      city: "Martlock",
      date: "2026-08-17T16:35:00",
    });
  });

  it("takes the lowest sell order within the selected city", () => {
    const folded = foldRows(
      [
        row({ city: "Martlock", quality: 4, sell_price_min: 900, sell_price_min_date: "2026-08-18T05:30:00" }),
        row({ city: "Martlock", quality: 4, sell_price_min: 700, sell_price_min_date: "2026-08-18T06:30:00" }),
      ],
      "Martlock",
    );
    expect(folded.quotes.get(KEY)?.price).toBe(700);
  });

  it("collects every other city's listing separately from the selected one", () => {
    const folded = foldRows(
      [
        row({ city: "Bridgewatch", sell_price_min: 9_685, sell_price_min_date: "2026-08-18T05:30:00" }),
        row({ city: "Caerleon", sell_price_min: 11_079, sell_price_min_date: "2026-08-17T20:35:00" }),
      ],
      "Martlock",
    );
    expect(folded.quotes.size).toBe(0);
    expect(folded.elsewhere.get(KEY)).toEqual([
      expect.objectContaining({ price: 9_685, city: "Bridgewatch" }),
      expect.objectContaining({ price: 11_079, city: "Caerleon" }),
    ]);
  });

  it("carries the dearest listing alongside the cheapest", () => {
    const folded = foldRows(
      [
        row({
          city: "Bridgewatch",
          sell_price_min: 9_685,
          sell_price_max: 31_255,
          sell_price_min_date: "2026-08-18T05:30:00",
        }),
      ],
      "Bridgewatch",
    );
    expect(folded.quotes.get(KEY)).toMatchObject({ price: 9_685, maxPrice: 31_255 });
  });

  it("omits the range when every listing is the same price", () => {
    const folded = foldRows(
      [
        row({
          city: "Caerleon",
          sell_price_min: 11_079,
          sell_price_max: 11_079,
          sell_price_min_date: "2026-08-18T05:30:00",
        }),
      ],
      "Caerleon",
    );
    expect(folded.quotes.get(KEY)?.maxPrice).toBeUndefined();
  });

  it("never uses a buy order, however high", () => {
    const folded = foldRows(
      [
        row({
          city: "Martlock",
          sell_price_min: 0,
          buy_price_max: 30_000,
          buy_price_max_date: "2026-08-18T05:00:00",
        }),
      ],
      "Martlock",
    );
    expect(folded.quotes.size).toBe(0);
    expect(folded.elsewhere.size).toBe(0);
  });

  it("excludes the Black Market from both the price and the fallback hint", () => {
    const folded = foldRows(
      [
        row({ city: "Black Market", sell_price_min: 7_212, sell_price_min_date: "2026-08-17T13:25:00" }),
      ],
      "Caerleon",
    );
    expect(folded.quotes.size).toBe(0);
    expect(folded.elsewhere.size).toBe(0);
  });

  it("ignores zero prices and empty sentinel dates", () => {
    expect(foldRows([row({ sell_price_min: 0 })], "Caerleon").quotes.size).toBe(0);
    expect(foldRows([row({ sell_price_min: 500 })], "Caerleon").quotes.size).toBe(0);
  });

  it("keeps qualities of the same item apart", () => {
    const folded = foldRows(
      [
        row({ quality: 1, sell_price_min: 100, sell_price_min_date: "2026-08-18T05:30:00" }),
        row({ quality: 4, sell_price_min: 900, sell_price_min_date: "2026-08-18T05:30:00" }),
      ],
      "Caerleon",
    );
    expect(folded.quotes.get(quoteKey("T4_BAG@1", 1))?.price).toBe(100);
    expect(folded.quotes.get(quoteKey("T4_BAG@1", 4))?.price).toBe(900);
  });
});

describe("fetchPrices", () => {
  it("makes no request when there is nothing to price", async () => {
    const fetcher = jsonFetcher([]);
    const result = await fetchPrices([], "east", "Caerleon", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.quotes.size).toBe(0);
  });

  it("groups requests by quality so unused combinations are never fetched", async () => {
    const fetcher = jsonFetcher([]);
    await fetchPrices(
      [
        { itemId: "T4_BAG@1", quality: 4 },
        { itemId: "T4_CAPE@2", quality: 4 },
        { itemId: "T3_MOUNT_HORSE", quality: 1 },
      ],
      "east",
      "Caerleon",
      fetcher,
    );
    const urls = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(urls).toHaveLength(2);
    expect(urls.some((url: string) => url.includes("qualities=4") && url.includes("T4_CAPE"))).toBe(true);
    expect(urls.some((url: string) => url.includes("qualities=1") && url.includes("MOUNT_HORSE"))).toBe(true);
  });

  it("does not filter cities server-side — every market is needed for the fallback hint", async () => {
    const fetcher = jsonFetcher([]);
    await fetchPrices([{ itemId: "T4_BAG@1", quality: 4 }], "east", "Caerleon", fetcher);
    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).not.toContain("locations=");
  });

  it("returns the selected city's quote for a successful lookup", async () => {
    const fetcher = jsonFetcher([
      row({ city: "Martlock", sell_price_min: 1_234, sell_price_min_date: "2026-08-18T05:30:00" }),
      row({ city: "Thetford", sell_price_min: 999, sell_price_min_date: "2026-08-18T05:30:00" }),
    ]);
    const result = await fetchPrices([{ itemId: "T4_BAG@1", quality: 4 }], "east", "Martlock", fetcher);
    expect(result.quotes.get(KEY)?.price).toBe(1_234);
    expect(result.elsewhere.get(KEY)).toEqual([
      expect.objectContaining({ price: 999, city: "Thetford" }),
    ]);
    expect(result.totalFailure).toBe(false);
  });

  it("leaves an unknown item id unpriced without failing the request", async () => {
    const fetcher = jsonFetcher([]);
    const result = await fetchPrices([{ itemId: "T4_NOPE", quality: 4 }], "east", "Caerleon", fetcher);
    expect(result.quotes.size).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("retries once, then reports a total failure on rate limiting", async () => {
    const fetcher = jsonFetcher({ error: "rate limited" }, 429);
    const result = await fetchPrices([{ itemId: "T4_BAG@1", quality: 4 }], "east", "Caerleon", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.totalFailure).toBe(true);
    expect(result.warnings[0]).toMatch(/rate limit/i);
  });

  it("reports a timeout as a warning rather than throwing", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as Fetcher;
    const result = await fetchPrices([{ itemId: "T4_BAG@1", quality: 4 }], "east", "Caerleon", fetcher);
    expect(result.totalFailure).toBe(true);
    expect(result.warnings[0]).toMatch(/timed out/i);
  });

  it("keeps partial results when only one batch fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("T4_BAG")) throw new Error("network down");
      return new Response(
        JSON.stringify([
          row({
            item_id: "T3_MOUNT_HORSE",
            quality: 1,
            city: "Caerleon",
            sell_price_min: 5_000,
            sell_price_min_date: "2026-08-18T05:30:00",
          }),
        ]),
        { status: 200 },
      );
    }) as unknown as Fetcher;

    const result = await fetchPrices(
      [
        { itemId: "T4_BAG@1", quality: 4 },
        { itemId: "T3_MOUNT_HORSE", quality: 1 },
      ],
      "east",
      "Caerleon",
      fetcher,
    );
    expect(result.totalFailure).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/network down/);
    expect(result.quotes.get(quoteKey("T3_MOUNT_HORSE", 1))?.price).toBe(5_000);
  });
});

describe("fetchSalesHistory", () => {
  function series(overrides: Record<string, unknown> = {}) {
    return {
      location: "Bridgewatch",
      item_id: "T4_BAG@1",
      quality: 4,
      data: [
        { item_count: 1, avg_price: 9_000, timestamp: "2026-08-16T00:00:00" },
        { item_count: 6, avg_price: 23_000, timestamp: "2026-08-17T00:00:00" },
      ],
      ...overrides,
    };
  }

  it("weights the average by units sold, not by bucket", async () => {
    const fetcher = jsonFetcher([series()]);
    const result = await fetchSalesHistory(
      [{ itemId: "T4_BAG@1", quality: 4 }],
      "east",
      "Bridgewatch",
      fetcher,
      new Date("2026-08-18T12:00:00Z"),
    );
    // (9,000x1 + 23,000x6) / 7 = 21,000 — not the 16,000 a plain mean would give.
    expect(result.sales.get(KEY)).toMatchObject({
      price: 21_000,
      saleCount: 7,
      date: "2026-08-17T00:00:00",
    });
  });

  it("keeps other cities' sales separate from the selected city's", async () => {
    const fetcher = jsonFetcher([series({ location: "Martlock" })]);
    const result = await fetchSalesHistory(
      [{ itemId: "T4_BAG@1", quality: 4 }],
      "east",
      "Bridgewatch",
      fetcher,
      new Date("2026-08-18T12:00:00Z"),
    );
    expect(result.sales.size).toBe(0);
    expect(result.elsewhere.get(KEY)).toEqual([
      expect.objectContaining({ price: 21_000, city: "Martlock" }),
    ]);
  });

  it("drops Black Market sales — it only ever buys", async () => {
    const fetcher = jsonFetcher([series({ location: "Black Market" })]);
    const result = await fetchSalesHistory(
      [{ itemId: "T4_BAG@1", quality: 4 }],
      "east",
      "Bridgewatch",
      fetcher,
      new Date("2026-08-18T12:00:00Z"),
    );
    expect(result.sales.size).toBe(0);
    expect(result.elsewhere.size).toBe(0);
  });

  it("requests a 14-day window ending today", () => {
    const url = buildHistoryUrl("east", ["T4_BAG@1"], [4], new Date("2026-08-18T12:00:00Z"));
    expect(url).toContain("date=8-4-2026");
    expect(url).toContain("end_date=8-18-2026");
    expect(url).toContain("time-scale=24");
  });
});
