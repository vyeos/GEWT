import { afterEach, describe, expect, it, vi } from "vitest";
import { amountInWords, money, today } from "@/lib/format";

describe("format helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats today from local date parts instead of UTC ISO output", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 1, 30));
    expect(today()).toBe("2026-09-05");
  });

  it("formats INR values without paise", () => {
    expect(money(1234567)).toBe("₹12,34,567");
    expect(money(0)).toBe("₹0");
  });

  it("converts amounts to Indian-numbering words", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(125000)).toBe("Rupees One Lakh Twenty Five Thousand Only");
    expect(amountInWords(10200030)).toBe("Rupees One Crore Two Lakh Thirty Only");
    expect(amountInWords(-99.95)).toBe("Rupees Ninety Nine Only");
  });
});
