/** Founder-level cost, pipeline and ROI maths. Never invents numbers: unknown inputs stay unknown. */

export type CostBasis = "ACTUAL" | "ESTIMATED" | "UNAVAILABLE";

export interface CostLine {
  provider: string; // vaani | gemini | neon | email | scheduling | hosting | other
  amount_inr: number | null; // null when basis is UNAVAILABLE
  basis: CostBasis;
}

export interface CallStats {
  calls_total: number;
  calls_answered: number;
  qualified: number;
  consultations_booked: number;
}

const div = (a: number | null, b: number) => (a === null || b === 0 ? null : Math.round((a / b) * 100) / 100);

export function costSummary(lines: CostLine[], s: CallStats) {
  const unavailable = lines.filter((l) => l.basis === "UNAVAILABLE" || l.amount_inr === null).map((l) => l.provider);
  const known = lines.filter((l) => l.amount_inr !== null);
  const total = known.length ? known.reduce((n, l) => n + (l.amount_inr as number), 0) : null;
  const complete = lines.length > 0 && unavailable.length === 0;
  const basis: CostBasis = lines.length === 0 || !complete ? "UNAVAILABLE" : lines.every((l) => l.basis === "ACTUAL") ? "ACTUAL" : "ESTIMATED";
  return {
    total_inr: total, // sum of the known lines only
    total_is_complete: complete,
    basis_overall: basis,
    unavailable_providers: unavailable,
    per_answered_call_inr: complete ? div(total, s.calls_answered) : null,
    per_qualified_inr: complete ? div(total, s.qualified) : null,
    per_booked_consultation_inr: complete ? div(total, s.consultations_booked) : null,
  };
}

export interface PipelineLead {
  customer_key: string; // phone number or customer id; used to avoid double counting duplicate leads
  created_at: string;
  verdict: "QUALIFIED" | "UNQUALIFIED" | "NEEDS_REVIEW" | "ESCALATION";
  segment: string;
  designer: string | null;
  pipeline_low_inr: number | null;
  pipeline_high_inr: number | null;
  size_band?: string;
}

/** Indicative pipeline. One opportunity per customer (latest lead wins); only QUALIFIED and NEEDS_REVIEW count. */
export function pipeline(leads: PipelineLead[]) {
  const latest = new Map<string, PipelineLead>();
  for (const l of leads) {
    const cur = latest.get(l.customer_key);
    if (!cur || l.created_at > cur.created_at) latest.set(l.customer_key, l);
  }
  const live = [...latest.values()].filter((l) => l.verdict === "QUALIFIED" || l.verdict === "NEEDS_REVIEW");
  const sum = (xs: PipelineLead[]) => {
    const withValue = xs.filter((l) => l.pipeline_low_inr !== null);
    return {
      leads: xs.length,
      leads_with_estimate: withValue.length,
      leads_insufficient_data: xs.length - withValue.length,
      low_inr: withValue.reduce((n, l) => n + (l.pipeline_low_inr as number), 0),
      high_inr: withValue.some((l) => l.pipeline_high_inr === null) ? null : withValue.reduce((n, l) => n + (l.pipeline_high_inr as number), 0),
    };
  };
  const group = (key: (l: PipelineLead) => string) => {
    const m: Record<string, PipelineLead[]> = {};
    for (const l of live) (m[key(l)] ??= []).push(l);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sum(v)]));
  };
  return {
    label: "INDICATIVE PIPELINE — NOT CONFIRMED VALUE",
    total: sum(live),
    by_segment: group((l) => l.segment),
    by_status: group((l) => l.verdict),
    by_designer: group((l) => l.designer ?? "Unassigned"),
    by_size: group((l) => l.size_band ?? "Unknown"),
  };
}

export function roi(totalCostInr: number | null, costComplete: boolean, attributedBenefitInr: number | null) {
  if (!costComplete || totalCostInr === null || totalCostInr <= 0 || attributedBenefitInr === null) {
    return { status: "NOT_YET_MEASURABLE" as const, roi_percent: null, reason: !costComplete || totalCostInr === null ? "Some provider costs are unavailable." : "No confirmed, attributable revenue recorded yet." };
  }
  return { status: "MEASURED" as const, roi_percent: Math.round(((attributedBenefitInr - totalCostInr) / totalCostInr) * 1000) / 10, reason: "Confirmed attributable revenue against full recorded system cost." };
}
