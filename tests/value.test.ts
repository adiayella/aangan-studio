import { describe, expect, it } from "vitest";
import { ESTIMATE_LABEL, estimateValue } from "../src/value/estimate.js";
import { costSummary, pipeline, roi } from "../src/value/metrics.js";

describe("internal estimate", () => {
  it("full home uses carpet area and shows all tiers without picking one", () => {
    const e = estimateValue({ segment: "residential", full_home: true, rooms_in_scope: null, area_sqft: 1400 });
    expect(e.status).toBe("ESTIMATED");
    expect(e.tier_established).toBe(false);
    expect(e.scenarios.map((s) => s.tier)).toEqual(["standard", "premium", "luxury"]);
    expect(e.scenarios[0]).toMatchObject({ low_inr: 2_520_000, high_inr: 3_360_000 });
    expect(e.scenarios[2]).toMatchObject({ low_inr: 4_900_000, high_inr: null }); // luxury stays open-ended
    expect(e.pipeline_low_inr).toBe(2_520_000);
    expect(e.pipeline_high_inr).toBeNull();
    expect(e.label).toBe(ESTIMATE_LABEL);
  });
  it("partial project with unknown designed area is INSUFFICIENT_DATA, not the whole flat's area", () => {
    const e = estimateValue({ segment: "residential", full_home: false, rooms_in_scope: 3, area_sqft: 1100 });
    expect(e.status).toBe("INSUFFICIENT_DATA");
    expect(e.scenarios).toEqual([]);
    expect(e.pipeline_low_inr).toBeNull();
  });
  it("partial project uses the stated designed area, not the property area", () => {
    const e = estimateValue({ segment: "residential", full_home: false, rooms_in_scope: 2, area_sqft: 1100, designed_area_sqft: 400, spec_tier: "premium" });
    expect(e.scenarios).toEqual([{ tier: "premium", low_inr: 960_000, high_inr: 1_400_000 }]);
    expect(e.tier_established).toBe(true);
    expect(e.designed_area_sqft).toBe(400);
  });
  it("single room uses the all-in range", () => {
    const e = estimateValue({ segment: "residential", full_home: null, rooms_in_scope: 1, area_sqft: null });
    expect(e).toMatchObject({ status: "ESTIMATED", basis: "single_room_range", pipeline_low_inr: 350_000, pipeline_high_inr: 800_000 });
  });
  it("commercial uses commercial rates on the area", () => {
    const e = estimateValue({ segment: "commercial", full_home: null, rooms_in_scope: null, area_sqft: 800, designed_area_sqft: 800 });
    expect(e.scenarios.map((s) => [s.tier, s.low_inr, s.high_inr])).toEqual([["basic", 960_000, 1_440_000], ["mid_range", 1_440_000, 2_240_000], ["premium", 2_240_000, 3_200_000]]);
    expect(e.pipeline_high_inr).toBe(3_200_000);
  });
  it("unknown tier names are ignored, never invented", () => {
    const e = estimateValue({ segment: "residential", full_home: true, rooms_in_scope: null, area_sqft: 1000, spec_tier: "ultra" });
    expect(e.tier_established).toBe(false);
    expect(e.scenarios).toHaveLength(3);
  });
  it("unknown segment is INSUFFICIENT_DATA", () => {
    expect(estimateValue({ segment: "unknown", full_home: true, rooms_in_scope: null, area_sqft: 900 }).status).toBe("INSUFFICIENT_DATA");
  });
});

describe("pipeline", () => {
  const L = (o: object) => ({ customer_key: "a", created_at: "2026-09-01", verdict: "QUALIFIED" as const, segment: "residential", designer: "Aryan", pipeline_low_inr: 1_000_000, pipeline_high_inr: 2_000_000, ...o });
  it("counts each customer once and ignores unqualified leads", () => {
    const p = pipeline([L({}), L({ created_at: "2026-09-05", pipeline_low_inr: 1_500_000, pipeline_high_inr: 2_500_000 }), L({ customer_key: "b", verdict: "UNQUALIFIED" }), L({ customer_key: "c", pipeline_low_inr: null, pipeline_high_inr: null })]);
    expect(p.total).toMatchObject({ leads: 2, leads_with_estimate: 1, leads_insufficient_data: 1, low_inr: 1_500_000, high_inr: 2_500_000 });
  });
  it("open-ended highs make the total high unbounded", () => {
    const p = pipeline([L({ pipeline_high_inr: null })]);
    expect(p.total.high_inr).toBeNull();
  });
});

describe("costs and ROI", () => {
  const stats = { calls_total: 10, calls_answered: 8, qualified: 4, consultations_booked: 2 };
  it("computes per-unit costs only when every cost is known", () => {
    const s = costSummary([{ provider: "vaani", amount_inr: 400, basis: "ACTUAL" }, { provider: "gemini", amount_inr: 40, basis: "ESTIMATED" }], stats);
    expect(s).toMatchObject({ total_inr: 440, basis_overall: "ESTIMATED", per_answered_call_inr: 55, per_qualified_inr: 110, per_booked_consultation_inr: 220 });
  });
  it("refuses per-unit costs when a provider cost is unavailable", () => {
    const s = costSummary([{ provider: "vaani", amount_inr: 400, basis: "ACTUAL" }, { provider: "email", amount_inr: null, basis: "UNAVAILABLE" }], stats);
    expect(s.total_is_complete).toBe(false);
    expect(s.per_qualified_inr).toBeNull();
    expect(s.unavailable_providers).toEqual(["email"]);
  });
  it("ROI is NOT_YET_MEASURABLE without confirmed revenue or complete costs", () => {
    expect(roi(440, true, null).status).toBe("NOT_YET_MEASURABLE");
    expect(roi(440, false, 100000).status).toBe("NOT_YET_MEASURABLE");
  });
  it("ROI uses the formula when measurable", () => {
    expect(roi(1000, true, 5000)).toMatchObject({ status: "MEASURED", roi_percent: 400 });
  });
});
