// Live check against the real HubSpot account using one clearly marked TEST lead. Cleans up after itself.
import "../src/config.js";
import { hs } from "../src/hubspot/client.js";
import { syncEnquiry } from "../src/hubspot/sync.js";
import { qualify } from "../src/qualification/rules.js";
import { EnquiryFactsSchema } from "../src/qualification/types.js";
import { estimateValue } from "../src/value/estimate.js";

const facts = EnquiryFactsSchema.parse({ intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1400, locality: "Kothrud", city: "Pune", deadline_weeks: 24, decision_maker: "self" });
const lead = {
  enquiry_id: "TEST-" + Date.now(), customer_id: "TEST-CUST-" + Date.now(), call_id: "TEST-CALL", call_time: new Date().toISOString(), call_duration_sec: 252,
  name: "ZZ TEST Priya", phone: "9000000001", email: "zz-test@example.com", facts, property_type: "3BHK apartment", requirements: "TEST lead - safe to delete",
  deadline_text: "March", qualification: qualify(facts), summary: "TEST: Priya wants a full redesign of her 3BHK in Kothrud.",
  estimate: estimateValue(facts), designer: "Aryan Kulkarni", stage: "new" as const, consult: { status: "none" as const, starts_at: null, mode: null },
};

const a = await syncEnquiry(lead);
console.log("first sync :", a);
// Second sync, immediately: first WITHOUT remembered ids (search may lag), then WITH them (what the app really does).
const c0 = await syncEnquiry(lead);
console.log("no ids     :", c0);
const b = await syncEnquiry({ ...lead, hubspot_contact_id: a.contactId, hubspot_deal_id: a.dealId });
console.log("second sync:", b);
const ok = a.contactId === b.contactId && a.dealId === b.dealId && a.contactId === c0.contactId && !b.dealCreated && !b.contactCreated;
console.log("idempotent (no duplicates):", ok);

const deal = await hs("GET", `/crm/v3/objects/deals/${a.dealId}?properties=dealname,dealstage,pipeline,aangan_decision,aangan_check_budget,aangan_est_low_inr,aangan_est_high_inr,aangan_est_label,amount&associations=contacts,notes`);
console.log("deal:", JSON.stringify(deal.properties));
console.log("associations:", Object.keys(deal.associations ?? {}), "notes:", deal.associations?.notes?.results?.length ?? 0);

await hs("DELETE", `/crm/v3/objects/deals/${a.dealId}`);
await hs("DELETE", `/crm/v3/objects/contacts/${a.contactId}`);
console.log("cleaned up test records");
