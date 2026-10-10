import { z } from "zod";

/** Structured facts about a call. Gemini fills this in; the rules engine decides. */
export const EnquiryFactsSchema = z.object({
  existing_client_complaint: z.boolean().default(false),
  intent: z
    .enum(["design_and_execution", "advice_only", "self_execution", "unknown"])
    .default("unknown"),
  segment: z.enum(["residential", "commercial", "unknown"]).default("unknown"),
  commercial_type: z
    .enum(["office", "clinic", "studio", "restaurant", "hotel", "retail", "gym", "other"])
    .nullable()
    .default(null),
  area_sqft: z.number().positive().nullable().default(null),
  rooms_in_scope: z.number().int().positive().nullable().default(null),
  full_home: z.boolean().nullable().default(null),
  /** Carpet area actually being designed. Null unless stated, or the whole home is in scope. */
  designed_area_sqft: z.number().positive().nullable().default(null),
  /** Only when the caller explicitly established a specification level. */
  spec_tier: z.enum(["basic", "standard", "mid_range", "premium", "luxury"]).nullable().default(null),
  structural_changes: z.boolean().default(false),
  city: z.string().nullable().default(null), // e.g. "Pune", "Nashik"
  locality: z.string().nullable().default(null), // e.g. "Baner"
  /** Weeks from today until the caller needs the project complete. */
  deadline_weeks: z.number().nonnegative().nullable().default(null),
  budget_min_inr: z.number().nonnegative().nullable().default(null),
  budget_max_inr: z.number().nonnegative().nullable().default(null),
  decision_maker: z
    .enum(["self", "authorized_rep", "researching_for_other", "unknown"])
    .default("unknown"),
});
export type EnquiryFacts = z.infer<typeof EnquiryFactsSchema>;

export type CriterionStatus = "pass" | "fail" | "unclear";
export type Verdict = "QUALIFIED" | "UNQUALIFIED" | "NEEDS_REVIEW" | "ESCALATION";

export interface CriterionResult {
  key: "real_project" | "service_area" | "timeline" | "budget" | "decision_maker";
  status: CriterionStatus;
  reason: string;
  /** One question the agent may ask when status is unclear on criteria 1-3. */
  clarifying_question?: string;
}

export interface QualificationResult {
  verdict: Verdict;
  criteria: CriterionResult[];
  /** Plain-language reasons, for the audit log and the designer email. */
  explanation: string;
  /** Criteria that still need one question from the agent. */
  missing: string[];
  /** Uncertainties to hand to the designer (budget / decision-maker). */
  notes: string[];
}
