import { describe, expect, it } from "vitest";
import { indicators, type AnalysisInput } from "../src/analysis/indicators.js";
import { redact } from "../src/util/redact.js";
import { HUMAN_OWNED, noteBody, noteMarker, syncMeta, updateRules, dealProperties, type SyncLead } from "../src/hubspot/map.js";
import { qualify } from "../src/qualification/rules.js";
import { EnquiryFactsSchema } from "../src/qualification/types.js";
import { estimateValue } from "../src/value/estimate.js";

const base: AnalysisInput = { call_status: "completed", analysis: "done", verdict: "QUALIFIED", consult_status: "none", callback_requested: null, sentiment: "NEUTRAL" };

describe("call indicators", () => {
  it("booked consultation -> CONSULTATION_BOOKED, Normal priority", () => {
    expect(indicators({ ...base, consult_status: "confirmed" })).toMatchObject({ analysis_status: "COMPLETED", outcome: "CONSULTATION_BOOKED", priority: "NORMAL" });
  });
  it("qualified but not booked -> High priority", () => {
    expect(indicators(base)).toMatchObject({ outcome: "INFORMATION_GIVEN", priority: "HIGH" });
  });
  it("a pending (unconfirmed) consultation is not reported as booked", () => {
    expect(indicators({ ...base, consult_status: "pending" }).outcome).not.toBe("CONSULTATION_BOOKED");
  });
  it("complaint -> URGENT_ESCALATION / Urgent", () => {
    expect(indicators({ ...base, verdict: "ESCALATION", sentiment: "NEGATIVE" })).toMatchObject({ outcome: "URGENT_ESCALATION", priority: "URGENT" });
  });
  it("unqualified -> DECLINED / Low", () => {
    expect(indicators({ ...base, verdict: "UNQUALIFIED" })).toMatchObject({ outcome: "DECLINED", priority: "LOW" });
  });
  it("negative sentiment raises priority", () => {
    expect(indicators({ ...base, consult_status: "confirmed", sentiment: "NEGATIVE" }).priority).toBe("HIGH");
  });
  it("callback requested", () => {
    expect(indicators({ ...base, callback_requested: true }).outcome).toBe("CALLBACK_REQUESTED");
  });
  it("missed call is MISSED even though no analysis exists", () => {
    expect(indicators({ ...base, call_status: "missed", analysis: "pending", verdict: null })).toMatchObject({ analysis_status: "PENDING", outcome: "MISSED", sentiment: "UNKNOWN" });
  });
  it("missing analysis gives blank outcome and priority, never a negative result", () => {
    const r = indicators({ ...base, analysis: "pending", verdict: null, sentiment: null });
    expect(r).toMatchObject({ analysis_status: "PENDING", outcome: null, priority: null, sentiment: "UNKNOWN" });
  });
  it("failed analysis is FAILED, still no invented outcome", () => {
    expect(indicators({ ...base, analysis: "failed", verdict: null })).toMatchObject({ analysis_status: "FAILED", outcome: null });
  });
  it("unknown sentiment stays UNKNOWN", () => {
    expect(indicators({ ...base, sentiment: null }).sentiment).toBe("UNKNOWN");
  });
});

describe("redaction", () => {
  it("removes keys, phone numbers, emails and database urls", () => {
    const t = "401 Bearer abc.def-123 for +91 98765 43210 priya@gmail.com pat-na2-11111111-2222-3333-4444-555555555555 postgresql://u:p@h/db AQ.FAKEFAKEFAKEFAKEFAKEFAKE12345";
    const r = redact(t);
    expect(r).not.toMatch(/abc\.def|98765|priya@|11111111-2222|u:p@|FAKEFAKEFAKE/);
    expect(r).toContain("[phone]");
  });
  it("redacts bare Indian mobile numbers but keeps HubSpot record ids readable", () => {
    expect(redact("call 9876543210 or 919876543210")).not.toMatch(/9876543210/);
    expect(redact("2 records match (567244372673, 567244372674)")).toContain("567244372673");
  });
});

describe("update rules (never overwrite human decisions)", () => {
  const f = EnquiryFactsSchema.parse({ intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1400, locality: "Kothrud", city: "Pune", deadline_weeks: 24, decision_maker: "self" });
  const lead: SyncLead = {
    enquiry_id: "e1", customer_id: "c1", call_id: "call1", call_time: "2026-09-02T04:53:00Z", call_duration_sec: 252, name: "Priya Sathe", phone: "9876543210", email: null,
    facts: f, property_type: "3BHK", requirements: "Full redo", deadline_text: "March", qualification: qualify(f), summary: "S", estimate: estimateValue(f), designer: "Aryan", stage: "new",
    consult: { status: "none", starts_at: null, mode: null }, confirmed_deal_value_inr: 5,
    analysis: { indicators: indicators(base), next_action: "Call to book a site visit", followup_date: "2026-10-12", url: "https://desk.example/leads/e1" },
  };
  const props = dealProperties(lead, "p1", { new: "s1", lost: "s6" });
  it("never sends stage, pipeline, amount, follow-up status or confirmed values on an update", () => {
    const upd = updateRules(props, {});
    for (const k of HUMAN_OWNED) expect(upd).not.toHaveProperty(k);
  });
  it("fills next action and follow-up date only while empty in HubSpot", () => {
    expect(updateRules(props, {})).toMatchObject({ aangan_next_action: "Call to book a site visit", aangan_followup_date: "2026-10-12" });
    const kept = updateRules(props, { aangan_next_action: "Designer wrote this", aangan_followup_date: "2026-11-01" });
    expect(kept).not.toHaveProperty("aangan_next_action");
    expect(kept).not.toHaveProperty("aangan_followup_date");
  });
  it("omits indicators that are not available instead of blanking them", () => {
    const none = dealProperties({ ...lead, analysis: { indicators: indicators({ ...base, analysis: "pending", verdict: null, sentiment: null }), next_action: null, followup_date: null, url: null } }, "p1", {});
    expect(none).toMatchObject({ aangan_analysis_status: "PENDING", aangan_sentiment: "UNKNOWN" });
    expect(none).not.toHaveProperty("aangan_call_outcome");
    expect(none).not.toHaveProperty("aangan_priority");
    expect(none).not.toHaveProperty("aangan_next_action");
  });
  it("sync metadata carries status, time and a cleared error on success", () => {
    expect(syncMeta({ status: "SYNCED" })).toMatchObject({ aangan_sync_status: "SYNCED", aangan_sync_error: "" });
  });
  it("note carries the call marker and no estimate", () => {
    const n = noteBody(lead);
    expect(n).toContain(noteMarker("call1"));
    expect(n).not.toMatch(/ESTIMATE|INDICATIVE|2520000/i);
  });
});
