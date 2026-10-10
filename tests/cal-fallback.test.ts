import { describe, expect, it } from "vitest";
import { isWeekdayIST } from "../src/cal/fallback.js";

describe("post-call booking weekday rule", () => {
  it("Monday to Friday are allowed (India time)", () => {
    expect(isWeekdayIST("2026-10-12T03:30:00Z")).toBe(true); // Mon 9:00 IST
    expect(isWeekdayIST("2026-10-16T11:00:00Z")).toBe(true); // Fri 16:30 IST
  });
  it("Saturday and Sunday are refused", () => {
    expect(isWeekdayIST("2026-10-17T05:00:00Z")).toBe(false); // Sat 10:30 IST
    expect(isWeekdayIST("2026-10-18T05:00:00Z")).toBe(false); // Sun
  });
  it("uses India time, not UTC, at the day boundary", () => {
    expect(isWeekdayIST("2026-10-16T19:00:00Z")).toBe(false); // Fri 19:00Z = Sat 00:30 IST
  });
});
