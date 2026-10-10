import type { EnquiryFacts } from "../qualification/types.js";

/**
 * INTERNAL INDICATIVE ESTIMATE - NOT A QUOTATION.
 * Rates come from pricing.md. This module is server-only: its output must never reach the voice agent,
 * a customer email, a designer-visible view, or a log line.
 */

export const ESTIMATE_LABEL = "INTERNAL INDICATIVE ESTIMATE — NOT A QUOTATION";

type Rate = { low: number; high: number | null }; // high === null means open-ended (never invent an upper limit)

const RESIDENTIAL: Record<string, Rate> = {
  standard: { low: 1800, high: 2400 },
  premium: { low: 2400, high: 3500 },
  luxury: { low: 3500, high: null },
};
const COMMERCIAL: Record<string, Rate> = {
  basic: { low: 1200, high: 1800 },
  mid_range: { low: 1800, high: 2800 },
  premium: { low: 2800, high: 4000 },
};
const SINGLE_ROOM: Rate = { low: 350_000, high: 800_000 };

export type EstimateStatus = "ESTIMATED" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE";

export interface Scenario {
  tier: string;
  low_inr: number;
  high_inr: number | null;
}

export interface Estimate {
  label: typeof ESTIMATE_LABEL;
  status: EstimateStatus;
  basis: "per_sqft_designed_area" | "single_room_range" | null;
  designed_area_sqft: number | null;
  tier_established: boolean;
  scenarios: Scenario[];
  /**
   * One figure per lead for pipeline totals. Alternative tiers are NOT separate opportunities:
   * pipeline_low is the lowest scenario's low end; pipeline_high is null when any scenario is open-ended.
   */
  pipeline_low_inr: number | null;
  pipeline_high_inr: number | null;
  missing: string[];
}

export interface EstimateInput extends Pick<EnquiryFacts, "segment" | "rooms_in_scope" | "full_home" | "area_sqft"> {
  /** Area that will actually be designed. Never defaulted from the property's total area unless it is a full home. */
  designed_area_sqft?: number | null;
  /** Only set when the customer explicitly established a specification level. */
  spec_tier?: string | null;
}

const empty = (status: EstimateStatus, missing: string[] = []): Estimate => ({
  label: ESTIMATE_LABEL, status, basis: null, designed_area_sqft: null, tier_established: false,
  scenarios: [], pipeline_low_inr: null, pipeline_high_inr: null, missing,
});

function fromScenarios(base: Omit<Estimate, "pipeline_low_inr" | "pipeline_high_inr" | "scenarios" | "status" | "missing">, scenarios: Scenario[]): Estimate {
  return {
    ...base, status: "ESTIMATED", scenarios, missing: [],
    pipeline_low_inr: Math.min(...scenarios.map((s) => s.low_inr)),
    pipeline_high_inr: scenarios.some((s) => s.high_inr === null) ? null : Math.max(...scenarios.map((s) => s.high_inr as number)),
  };
}

export function estimateValue(i: EstimateInput): Estimate {
  if (i.segment === "unknown") return empty("INSUFFICIENT_DATA", ["property category (residential or commercial)"]);

  // Single-room redesign: the guide gives an all-in range, not a per-sq-ft rate.
  if (i.segment === "residential" && i.rooms_in_scope === 1 && i.full_home !== true) {
    return fromScenarios(
      { label: ESTIMATE_LABEL, basis: "single_room_range", designed_area_sqft: i.designed_area_sqft ?? null, tier_established: false },
      [{ tier: "single_room_all_in", low_inr: SINGLE_ROOM.low, high_inr: SINGLE_ROOM.high }],
    );
  }

  // Designed area: explicit value, or the whole carpet area only when the whole home is being designed.
  let area = i.designed_area_sqft ?? null;
  if (area === null && i.full_home === true) area = i.area_sqft;
  if (area === null) return empty("INSUFFICIENT_DATA", ["designed area (carpet sq ft actually being designed)"]);

  const table = i.segment === "commercial" ? COMMERCIAL : RESIDENTIAL;
  const tier = i.spec_tier && table[i.spec_tier] ? i.spec_tier : null;
  const chosen = tier ? [[tier, table[tier]] as const] : Object.entries(table); // no tier -> show scenarios, never pick one
  return fromScenarios(
    { label: ESTIMATE_LABEL, basis: "per_sqft_designed_area", designed_area_sqft: area, tier_established: tier !== null },
    chosen.map(([t, r]) => ({ tier: t, low_inr: Math.round(area! * r.low), high_inr: r.high === null ? null : Math.round(area! * r.high) })),
  );
}
