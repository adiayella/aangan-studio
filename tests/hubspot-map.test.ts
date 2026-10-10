import { describe, expect, it } from "vitest";
import { contactProperties, dealProperties, noteBody, normalizePhone, type SyncLead } from "../src/hubspot/map.js";
import { qualify } from "../src/qualification/rules.js";
import { EnquiryFactsSchema } from "../src/qualification/types.js";
import { estimateValue } from "../src/value/estimate.js";

const STAGES = { new: "s1", contacted: "s2", consult_scheduled: "s3", consult_done: "s4", won: "s5", lost: "s6" };

function lead(facts: object, over: Partial<SyncLead> = {}): SyncLead {
  const f = EnquiryFactsSchema.parse(facts);
  return {
    enquiry_id: "e1", customer_id: "c1", call_id: "call1", call_time: "2026-09-02T04:53:00Z", call_duration_sec: 252,
    name: "Priya Sathe", phone: "098765 43210", email: null, facts: f, property_type: "3BHK", requirements: "Full redo",
    deadline_text: "March", qualification: qualify(f), summary: "Priya wants a full redesign.",
    estimate: estimateValue(f), designer: "Aryan", stage: "new", consult: { status: "none", starts_at: null, mode: null }, ...over,
  };
}
const good = { intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1400, locality: "Kothrud", city: "Pune", deadline_weeks: 24, decision_maker: "self" };

describe("HubSpot mapping", () => {
  it("normalises Indian phone numbers", () => {
    expect(normalizePhone("098765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("123")).toBeNull();
  });
  it("splits the name and omits missing fields instead of sending blanks", () => {
    const p = contactProperties(lead(good));
    expect(p).toMatchObject({ firstname: "Priya", lastname: "Sathe", phone: "+919876543210" });
    expect(p).not.toHaveProperty("email");
  });
  it("drops malformed emails instead of sending them", () => {
    expect(contactProperties(lead(good, { email: "priya at gmail dot com" }))).not.toHaveProperty("email");
    expect(contactProperties(lead(good, { email: " Priya@Gmail.com " }))).toMatchObject({ email: "priya@gmail.com" });
  });
  it("shows PASS / FAIL / UNCERTAIN and the right decision label", () => {
    const d = dealProperties(lead(good), "p1", STAGES);
    expect(d).toMatchObject({ aangan_check_service_area: "PASS", aangan_check_budget: "UNCERTAIN", aangan_decision: "QUALIFIED", dealstage: "s1" });
  });
  it("maps ESCALATION to URGENT_ESCALATION", () => {
    const d = dealProperties(lead({ existing_client_complaint: true }), "p1", STAGES);
    expect(d.aangan_decision).toBe("URGENT_ESCALATION");
  });
  it("puts unqualified leads in Lost with a reason category", () => {
    const d = dealProperties(lead({ intent: "design_and_execution", city: "Nashik" }), "p1", STAGES);
    expect(d).toMatchObject({ dealstage: "s6", aangan_decision: "UNQUALIFIED", aangan_decline_category: "out_of_area" });
  });
  it("never puts an estimate in the deal amount; only confirmed value goes there", () => {
    expect(dealProperties(lead(good), "p1", STAGES)).not.toHaveProperty("amount");
    expect(dealProperties(lead(good, { confirmed_deal_value_inr: 900000 }), "p1", STAGES).amount).toBe(900000);
  });
  it("labels the estimate and leaves the open-ended high blank", () => {
    const d = dealProperties(lead(good), "p1", STAGES) as Record<string, unknown>;
    expect(d.aangan_est_label).toBe("INTERNAL INDICATIVE ESTIMATE — NOT A QUOTATION");
    expect(d.aangan_est_low_inr).toBe(2_520_000);
    expect(d).not.toHaveProperty("aangan_est_high_inr");
    expect(String(d.aangan_est_scenarios)).toContain("luxury: 4900000+ (open-ended)");
  });
  it("shows INSUFFICIENT DATA when the designed area is unknown", () => {
    const d = dealProperties(lead({ ...good, full_home: false, rooms_in_scope: 3 }), "p1", STAGES) as Record<string, unknown>;
    expect(d.aangan_est_status).toBe("INSUFFICIENT_DATA");
    expect(String(d.aangan_est_scenarios)).toMatch(/INSUFFICIENT DATA/);
  });
  it("declined and escalated leads carry NOT_APPLICABLE and cleared estimate numbers", () => {
    const d = dealProperties(lead({ intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1000, city: "Nashik" }), "p1", STAGES) as Record<string, unknown>;
    expect(d).toMatchObject({ aangan_est_status: "NOT_APPLICABLE", aangan_est_low_inr: "", aangan_est_high_inr: "", aangan_est_scenarios: "" });
    const e = dealProperties(lead({ existing_client_complaint: true }), "p1", STAGES) as Record<string, unknown>;
    expect(e).toMatchObject({ aangan_est_status: "NOT_APPLICABLE", aangan_est_low_inr: "" });
  });
  it("keeps estimates and rupee figures out of the timeline note", () => {
    const n = noteBody(lead(good));
    expect(n).not.toMatch(/INDICATIVE|ESTIMATE|2520000|₹|lakh/i);
  });
});
