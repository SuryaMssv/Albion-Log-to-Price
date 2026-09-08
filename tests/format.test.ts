import { describe, expect, it } from "vitest";
import { formatChestStamp, itemIconUrl } from "@/lib/format";

describe("formatChestStamp", () => {
  it("shows UTC 12-hour time and IST in brackets", () => {
    expect(formatChestStamp("09/06/2026 11:52:07")).toBe("6/Sep/26 11:52 am [5:22 pm]");
  });

  it("converts afternoon UTC into pm and rolls IST past midnight without changing the UTC date", () => {
    expect(formatChestStamp("08/18/2026 14:00:00")).toBe("18/Aug/26 2:00 pm [7:30 pm]");
    expect(formatChestStamp("09/06/2026 23:00:00")).toBe("6/Sep/26 11:00 pm [4:30 am]");
  });

  it("keeps a date-only stamp without a time", () => {
    expect(formatChestStamp("09/06/2026")).toBe("6/Sep/26");
  });

  it("returns the original string when it is not a chest date", () => {
    expect(formatChestStamp("not a date")).toBe("not a date");
  });
});

describe("itemIconUrl", () => {
  it("points at the game render of that item id and quality", () => {
    expect(itemIconUrl("T4_BAG@1", 4)).toBe(
      "https://render.albiononline.com/v1/item/T4_BAG@1.png?quality=4",
    );
  });
});
