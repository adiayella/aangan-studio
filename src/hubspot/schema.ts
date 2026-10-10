/** The HubSpot structure Aangan needs. Internal names are stable; labels are what Nikhil sees. */

export type Def = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "datetime" | "date" | "enum";
  options?: [value: string, label: string][];
  description?: string;
  unique?: boolean;
};

export const GROUPS = {
  ai: { name: "aangan_ai", label: "Aangan AI Receptionist" },
  internal: { name: "aangan_internal", label: "Aangan Internal Pricing (confidential)" },
  metrics: { name: "aangan_metrics", label: "Aangan AI System Metrics" },
};

const CHECK: [string, string][] = [["PASS", "Pass"], ["FAIL", "Fail"], ["UNCERTAIN", "Uncertain"]];

export const CONTACT_PROPS: Def[] = [
  { name: "aangan_neon_customer_id", label: "Aangan customer ID", kind: "text", unique: true },
  { name: "aangan_lead_source", label: "Aangan lead source", kind: "text", description: "How the enquiry arrived, e.g. AI phone receptionist" },
];

export const DEAL_AI_PROPS: Def[] = [
  { name: "aangan_neon_enquiry_id", label: "Aangan enquiry ID", kind: "text", unique: true },
  { name: "aangan_call_id", label: "Call ID", kind: "text" },
  { name: "aangan_call_time", label: "Call time", kind: "datetime" },
  { name: "aangan_call_duration_sec", label: "Call duration (sec)", kind: "number" },
  { name: "aangan_category", label: "Project category", kind: "enum", options: [["residential", "Residential"], ["commercial", "Commercial"], ["unknown", "Unknown"]] },
  { name: "aangan_property_type", label: "Property type", kind: "text" },
  { name: "aangan_locality", label: "Locality", kind: "text" },
  { name: "aangan_city", label: "City", kind: "text" },
  { name: "aangan_area_sqft", label: "Property carpet area (sq ft)", kind: "number" },
  { name: "aangan_designed_area_sqft", label: "Designed area (sq ft)", kind: "number" },
  { name: "aangan_scope", label: "Requested scope", kind: "textarea" },
  { name: "aangan_timeline", label: "Requested timeline", kind: "text" },
  { name: "aangan_check_real_project", label: "Check 1: Real project", kind: "enum", options: CHECK },
  { name: "aangan_check_service_area", label: "Check 2: Location", kind: "enum", options: CHECK },
  { name: "aangan_check_timeline", label: "Check 3: Timeline", kind: "enum", options: CHECK },
  { name: "aangan_check_budget", label: "Check 4: Budget", kind: "enum", options: CHECK },
  { name: "aangan_check_decision_maker", label: "Check 5: Decision-maker", kind: "enum", options: CHECK },
  { name: "aangan_check_notes", label: "Check explanations", kind: "textarea" },
  { name: "aangan_decision", label: "Qualification decision", kind: "enum", options: [["QUALIFIED", "Qualified"], ["UNQUALIFIED", "Unqualified"], ["NEEDS_REVIEW", "Needs review"], ["URGENT_ESCALATION", "Urgent escalation"]] },
  { name: "aangan_decision_reason", label: "Decision reason", kind: "textarea" },
  { name: "aangan_decline_category", label: "Disqualification reason", kind: "enum", options: [["out_of_area", "Outside Pune/PCMC"], ["advice_only", "Advice only"], ["out_of_scope", "Project type out of scope"], ["timeline", "Timeline not feasible"], ["budget", "Budget mismatch"], ["other", "Other"]] },
  { name: "aangan_call_summary", label: "AI call summary", kind: "textarea" },
  { name: "aangan_designer", label: "Assigned designer", kind: "text" },
  { name: "aangan_consult_status", label: "Consultation status", kind: "enum", options: [["none", "Not booked"], ["pending", "Pending confirmation"], ["confirmed", "Confirmed"], ["completed", "Completed"], ["cancelled", "Cancelled"]] },
  { name: "aangan_consult_time", label: "Consultation time", kind: "datetime" },
  { name: "aangan_consult_mode", label: "Consultation type", kind: "enum", options: [["online", "Online"], ["site_visit", "Site visit"]] },
  { name: "aangan_followup_status", label: "Follow-up status", kind: "text" },
];

/** Call-analysis indicators (approved mapping, milestone 1). */
export const DEAL_ANALYSIS_PROPS: Def[] = [
  { name: "aangan_analysis_status", label: "Analysis status", kind: "enum", options: [["PENDING", "Pending"], ["COMPLETED", "Completed"], ["FAILED", "Failed"]] },
  { name: "aangan_call_outcome", label: "Call outcome", kind: "enum", description: "What happened on the call. Separate from the deal stage.", options: [["CONSULTATION_BOOKED", "Consultation booked"], ["CALLBACK_REQUESTED", "Callback requested"], ["INFORMATION_GIVEN", "Information given"], ["DECLINED", "Declined (not a fit)"], ["URGENT_ESCALATION", "Urgent escalation"], ["DISCONNECTED", "Disconnected"], ["MISSED", "Missed"]] },
  { name: "aangan_sentiment", label: "Customer sentiment", kind: "enum", options: [["POSITIVE", "Positive"], ["NEUTRAL", "Neutral"], ["NEGATIVE", "Negative"], ["UNKNOWN", "Unknown"]] },
  { name: "aangan_priority", label: "Follow-up priority", kind: "enum", options: [["URGENT", "Urgent"], ["HIGH", "High"], ["NORMAL", "Normal"], ["LOW", "Low"]] },
  { name: "aangan_next_action", label: "Next action", kind: "text", description: "Suggested by the AI; only written when empty. Edit freely." },
  { name: "aangan_followup_date", label: "Follow-up date", kind: "date", description: "Suggested by the AI; only written when empty. Edit freely." },
  { name: "aangan_analysis_url", label: "Call analysis link", kind: "text" },
  { name: "aangan_last_synced_at", label: "Last synced at", kind: "datetime" },
  { name: "aangan_sync_status", label: "Sync status", kind: "enum", options: [["SYNCED", "Synced"], ["FAILED", "Failed"], ["NEEDS_MATCH_REVIEW", "Needs match review"]] },
  { name: "aangan_sync_error", label: "Last sync error", kind: "textarea" },
];

export const DEAL_INTERNAL_PROPS: Def[] = [
  { name: "aangan_est_label", label: "Estimate label", kind: "text" },
  { name: "aangan_est_status", label: "Estimate status", kind: "enum", options: [["ESTIMATED", "Estimated"], ["INSUFFICIENT_DATA", "Insufficient data"], ["NOT_APPLICABLE", "Not applicable"]] },
  { name: "aangan_est_low_inr", label: "Indicative value, low (INR)", kind: "number", description: "INTERNAL INDICATIVE ESTIMATE — NOT A QUOTATION" },
  { name: "aangan_est_high_inr", label: "Indicative value, high (INR)", kind: "number", description: "Blank when open-ended" },
  { name: "aangan_est_scenarios", label: "Estimate scenarios", kind: "textarea" },
  { name: "aangan_confirmed_deal_value_inr", label: "Confirmed deal value (INR)", kind: "number" },
  { name: "aangan_actual_revenue_inr", label: "Actual revenue (INR)", kind: "number" },
];

export const COMPANY_PROPS: Def[] = [
  { name: "aangan_m_period", label: "Metrics period", kind: "text" },
  { name: "aangan_m_updated_at", label: "Metrics updated at", kind: "datetime" },
  { name: "aangan_m_calls_total", label: "Incoming calls", kind: "number" },
  { name: "aangan_m_calls_answered", label: "Calls answered", kind: "number" },
  { name: "aangan_m_calls_missed", label: "Calls missed", kind: "number" },
  { name: "aangan_m_avg_duration_sec", label: "Average call duration (sec)", kind: "number" },
  { name: "aangan_m_qualified", label: "Qualified enquiries", kind: "number" },
  { name: "aangan_m_unqualified", label: "Unqualified enquiries", kind: "number" },
  { name: "aangan_m_needs_review", label: "Needs review", kind: "number" },
  { name: "aangan_m_escalations", label: "Urgent escalations", kind: "number" },
  { name: "aangan_m_consults_booked", label: "Consultations booked", kind: "number" },
  { name: "aangan_m_pipeline_low_inr", label: "Indicative pipeline, low (INR)", kind: "number" },
  { name: "aangan_m_pipeline_high_inr", label: "Indicative pipeline, high (INR)", kind: "number", description: "Blank when any lead is open-ended" },
  { name: "aangan_m_confirmed_value_inr", label: "Confirmed deal value (INR)", kind: "number" },
  { name: "aangan_m_actual_revenue_inr", label: "Actual revenue (INR)", kind: "number" },
  { name: "aangan_m_cost_total_inr", label: "System running cost, known items (INR)", kind: "number" },
  { name: "aangan_m_cost_status", label: "Cost data status", kind: "text", description: "ACTUAL, ESTIMATED or UNAVAILABLE, with the providers still missing" },
  { name: "aangan_m_cost_per_answered_inr", label: "Cost per answered call (INR)", kind: "number" },
  { name: "aangan_m_cost_per_qualified_inr", label: "Cost per qualified enquiry (INR)", kind: "number" },
  { name: "aangan_m_cost_per_consult_inr", label: "Cost per booked consultation (INR)", kind: "number" },
  { name: "aangan_m_roi_status", label: "ROI status", kind: "text" },
  { name: "aangan_m_roi_percent", label: "ROI (%)", kind: "number" },
];

export const PIPELINE = {
  label: "Aangan Enquiries",
  stages: [
    { key: "new", label: "New", probability: "0.1" },
    { key: "contacted", label: "Contacted", probability: "0.2" },
    { key: "consult_scheduled", label: "Consultation Scheduled", probability: "0.4" },
    { key: "consult_done", label: "Consultation Done", probability: "0.6" },
    { key: "won", label: "Won", probability: "1.0", closed: true },
    { key: "lost", label: "Lost", probability: "0.0", closed: true },
  ],
};

export const METRICS_COMPANY_NAME = "Aangan AI System";
