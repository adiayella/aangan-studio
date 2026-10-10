import type { CriterionResult, QualificationResult, EnquiryFacts } from "../qualification/types.js";
import type { Estimate } from "../value/estimate.js";
import type { Indicators } from "../analysis/indicators.js";

/** Everything the HubSpot sync needs about one processed call. Pure data: no database or network here. */
export interface SyncLead {
  enquiry_id: string;
  customer_id: string;
  call_id: string;
  call_time: string; // ISO
  call_duration_sec: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  facts: EnquiryFacts;
  property_type: string | null;
  requirements: string | null;
  deadline_text: string | null;
  qualification: QualificationResult;
  summary: string;
  estimate: Estimate;
  designer: string | null;
  stage: "new" | "contacted" | "consult_scheduled" | "consult_done" | "won" | "lost";
  consult: { status: "none" | "pending" | "confirmed" | "completed" | "cancelled"; starts_at: string | null; mode: "online" | "site_visit" | null };
  /** Ids remembered in Neon from an earlier sync. HubSpot search lags by seconds, so known ids are always preferred. */
  hubspot_contact_id?: string | null;
  hubspot_deal_id?: string | null;
  hubspot_note_id?: string | null;
  /** Call-analysis indicators. Absent means analysis has not produced them: nothing is written, nothing is erased. */
  analysis?: { indicators: Indicators; next_action: string | null; followup_date: string | null; url: string | null };
  confirmed_deal_value_inr?: number | null;
  actual_revenue_inr?: number | null;
}

const CHECK: Record<CriterionResult["status"], string> = { pass: "PASS", fail: "FAIL", unclear: "UNCERTAIN" };
const DECISION: Record<string, string> = { QUALIFIED: "QUALIFIED", UNQUALIFIED: "UNQUALIFIED", NEEDS_REVIEW: "NEEDS_REVIEW", ESCALATION: "URGENT_ESCALATION" };

/** Normalises Indian phone numbers to +91XXXXXXXXXX so the same caller is always found again. */
export function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  return d.length >= 8 ? `+${d}` : null;
}

export function declineCategory(q: QualificationResult): string | null {
  if (q.verdict !== "UNQUALIFIED") return null;
  const fail = (k: CriterionResult["key"]) => q.criteria.find((c) => c.key === k)?.status === "fail";
  if (fail("service_area")) return "out_of_area";
  if (fail("real_project")) return /advice|ideas|yourself/i.test(q.criteria.find((c) => c.key === "real_project")!.reason) ? "advice_only" : "out_of_scope";
  if (fail("timeline")) return "timeline";
  if (fail("budget")) return "budget";
  return "other";
}

const isoMs = (iso: string | null) => (iso ? String(new Date(iso).getTime()) : undefined);
/** Fields where an empty string is a deliberate "clear this value in HubSpot", not a missing value. */
const CLEARABLE = new Set(["aangan_est_low_inr", "aangan_est_high_inr", "aangan_est_scenarios"]);
const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && v !== null && (v !== "" || CLEARABLE.has(k))));

const EMAIL_RE = /^[^s@]+@[^s@]+.[A-Za-z]{2,}$/;
export const validEmail = (e: string | null) => (e && EMAIL_RE.test(e.trim()) ? e.trim().toLowerCase() : null);

export function contactProperties(l: SyncLead) {
  const [first, ...rest] = (l.name ?? "").trim().split(/\s+/);
  return compact({
    firstname: first || undefined, lastname: rest.join(" ") || undefined,
    phone: normalizePhone(l.phone) ?? undefined, email: validEmail(l.email) ?? undefined,
    aangan_neon_customer_id: l.customer_id, aangan_lead_source: "AI phone receptionist",
  });
}

export function dealProperties(l: SyncLead, pipelineId: string, stageIds: Record<string, string>) {
  const q = l.qualification, e = estimateForCrm(l), c = (k: CriterionResult["key"]) => q.criteria.find((x) => x.key === k);
  const stage = q.verdict === "UNQUALIFIED" ? "lost" : l.stage;
  const place = [l.facts.locality, l.facts.city].filter(Boolean)[0];
  return compact({
    dealname: [l.name ?? "Unknown caller", l.property_type, place].filter(Boolean).join(" — "),
    pipeline: pipelineId, dealstage: stageIds[stage],
    amount: l.confirmed_deal_value_inr ?? undefined, // only ever a confirmed figure, never an estimate
    aangan_neon_enquiry_id: l.enquiry_id, aangan_call_id: l.call_id, aangan_call_time: isoMs(l.call_time),
    aangan_call_duration_sec: l.call_duration_sec ?? undefined,
    aangan_category: l.facts.segment, aangan_property_type: l.property_type ?? undefined,
    aangan_locality: l.facts.locality ?? undefined, aangan_city: l.facts.city ?? undefined,
    aangan_area_sqft: l.facts.area_sqft ?? undefined, aangan_designed_area_sqft: l.facts.designed_area_sqft ?? undefined,
    aangan_scope: l.requirements ?? undefined, aangan_timeline: l.deadline_text ?? undefined,
    aangan_check_real_project: c("real_project") && CHECK[c("real_project")!.status],
    aangan_check_service_area: c("service_area") && CHECK[c("service_area")!.status],
    aangan_check_timeline: c("timeline") && CHECK[c("timeline")!.status],
    aangan_check_budget: c("budget") && CHECK[c("budget")!.status],
    aangan_check_decision_maker: c("decision_maker") && CHECK[c("decision_maker")!.status],
    aangan_check_notes: q.criteria.map((x) => `${x.key}: ${CHECK[x.status]} — ${x.reason}`).join("\n") || undefined,
    aangan_decision: DECISION[q.verdict], aangan_decision_reason: q.explanation,
    aangan_decline_category: declineCategory(q) ?? undefined,
    aangan_call_summary: l.summary, aangan_designer: l.designer ?? undefined,
    aangan_consult_status: l.consult.status, aangan_consult_time: isoMs(l.consult.starts_at), aangan_consult_mode: l.consult.mode ?? undefined,
    // Internal estimate, clearly labelled. Hide this group from non-founder users in HubSpot.
    aangan_est_label: e.label, aangan_est_status: e.status,
    aangan_est_low_inr: e.pipeline_low_inr ?? undefined, aangan_est_high_inr: e.pipeline_high_inr ?? undefined,
    aangan_est_scenarios: e.scenarios.length
      ? e.scenarios.map((s) => `${s.tier}: ${s.low_inr}${s.high_inr === null ? "+ (open-ended)" : `–${s.high_inr}`}`).join("\n")
      : e.missing.length ? `INSUFFICIENT DATA — missing: ${e.missing.join(", ")}` : undefined,
    aangan_confirmed_deal_value_inr: l.confirmed_deal_value_inr ?? undefined, aangan_actual_revenue_inr: l.actual_revenue_inr ?? undefined,
    ...analysisProperties(l),
    ...(e.status === "NOT_APPLICABLE" ? { aangan_est_low_inr: "", aangan_est_high_inr: "", aangan_est_scenarios: "" } : {}),
  });
}

/**
 * Declined (UNQUALIFIED) and escalated leads are not sales opportunities, so they carry no value estimate:
 * the status is NOT_APPLICABLE and the numbers are explicitly cleared, so pipeline sums can never include them.
 */
function estimateForCrm(l: SyncLead): SyncLead["estimate"] {
  if (l.qualification.verdict === "UNQUALIFIED" || l.qualification.verdict === "ESCALATION")
    return { ...l.estimate, status: "NOT_APPLICABLE", basis: null, scenarios: [], pipeline_low_inr: null, pipeline_high_inr: null, missing: [] };
  return l.estimate;
}

/** Indicator fields. Null/absent values are omitted so an existing HubSpot value is never blanked out. */
function analysisProperties(l: SyncLead) {
  const a = l.analysis;
  if (!a) return {};
  const i = a.indicators;
  return compact({
    aangan_analysis_status: i.analysis_status, aangan_call_outcome: i.outcome ?? undefined,
    aangan_sentiment: i.sentiment, aangan_priority: i.priority ?? undefined,
    aangan_next_action: a.next_action ?? undefined, aangan_followup_date: a.followup_date ?? undefined,
    aangan_analysis_url: a.url ?? undefined,
  });
}

/** Fields a person owns. After a deal exists the system never writes them. */
export const HUMAN_OWNED = ["pipeline", "dealstage", "amount", "aangan_followup_status", "aangan_confirmed_deal_value_inr", "aangan_actual_revenue_inr"];
/** Written by the AI only while the field is still empty in HubSpot. */
export const FILL_IF_EMPTY = ["aangan_next_action", "aangan_followup_date"];

/** Properties to send when updating an existing deal, given the values currently in HubSpot. */
export function updateRules(props: Record<string, unknown>, existing: Record<string, string | null | undefined>) {
  const out = { ...props };
  for (const k of HUMAN_OWNED) delete out[k];
  for (const k of FILL_IF_EMPTY) if (existing[k]) delete out[k];
  return out;
}

export type SyncMeta = { status: "SYNCED" | "FAILED" | "NEEDS_MATCH_REVIEW"; error?: string | null; at?: Date };
export function syncMeta(m: SyncMeta) {
  return { aangan_sync_status: m.status, aangan_last_synced_at: String((m.at ?? new Date()).getTime()), aangan_sync_error: m.error ?? "" };
}

/** Marker embedded in every call note so a retry can find an existing note instead of adding a second one. */
export const noteMarker = (callId: string) => `[call:${callId}]`;

/** Note body for the timeline. Deliberately contains no estimate or pricing information. */
export function noteBody(l: SyncLead): string {
  return [
    `AI call summary (${new Date(l.call_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST)`,
    l.summary, "",
    `Decision: ${DECISION[l.qualification.verdict]} — ${l.qualification.explanation}`,
    ...l.qualification.notes.map((n) => `Note: ${n}`),
    "", noteMarker(l.call_id),
  ].join("\n");
}
