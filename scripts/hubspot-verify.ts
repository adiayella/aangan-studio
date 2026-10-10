// Live verification of the call-analysis -> HubSpot sync using designated TEST records (all marked ZZ TEST). Cleans up after itself.
// Usage: npx tsx scripts/hubspot-verify.ts
import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../src/config.js";
import { indicators } from "../src/analysis/indicators.js";
import { hs } from "../src/hubspot/client.js";
import type { SyncLead } from "../src/hubspot/map.js";
import { retryFailed, runTrackedSync } from "../src/hubspot/track.js";
import { qualify } from "../src/qualification/rules.js";
import { EnquiryFactsSchema } from "../src/qualification/types.js";
import { estimateValue } from "../src/value/estimate.js";

const db = new pg.Pool({ connectionString: env("DATABASE_URL"), max: 2 });
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const facts = EnquiryFactsSchema.parse({ intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1400, locality: "Kothrud", city: "Pune", deadline_weeks: 24, decision_maker: "self" });
const mk = (phone: string, over: Partial<SyncLead> = {}): SyncLead => ({
  enquiry_id: randomUUID(), customer_id: randomUUID(), call_id: "ZZ-CALL-" + randomUUID().slice(0, 8), call_time: new Date().toISOString(), call_duration_sec: 252,
  name: "ZZ TEST Priya", phone, email: "zz.test@gmail.com", facts, property_type: "3BHK apartment", requirements: "TEST lead - safe to delete", deadline_text: "March",
  qualification: qualify(facts), summary: "TEST: wants a full redesign of her 3BHK in Kothrud.", estimate: estimateValue(facts), designer: "Aryan Kulkarni", stage: "new",
  consult: { status: "none", starts_at: null, mode: null },
  analysis: { indicators: indicators({ call_status: "completed", analysis: "done", verdict: "QUALIFIED", consult_status: "none", callback_requested: false, sentiment: "NEUTRAL" }), next_action: "AI: call to book a site visit", followup_date: "2026-10-20", url: "https://example.com/lead" },
  ...over,
});

const created = { deals: new Set<string>(), contacts: new Set<string>(), enquiries: new Set<string>() };
const track = async (l: SyncLead) => {
  if (!created.enquiries.has(l.enquiry_id)) { await db.query("insert into enquiries (id) values ($1)", [l.enquiry_id]); created.enquiries.add(l.enquiry_id); }
  const r = await runTrackedSync(db, l);
  if (r.result) { created.deals.add(r.result.dealId); if (r.result.contactId) created.contacts.add(r.result.contactId); }
  return r;
};
const deal = (id: string, props: string) => hs<any>("GET", `/crm/v3/objects/deals/${id}?properties=${props}&associations=contacts,notes`);

try {
  const phone = "+9190000" + String(Date.now()).slice(-5);
  const L = mk(phone);

  // 1. completed analysis updates the test record
  const a = await track(L);
  const d1 = await deal(a.result!.dealId, "aangan_decision,aangan_analysis_status,aangan_call_outcome,aangan_priority,aangan_sentiment,aangan_sync_status,aangan_last_synced_at,aangan_sync_error,aangan_next_action,aangan_designer,aangan_check_budget,dealstage,pipeline,amount");
  const p1 = d1.properties;
  check("1 completed analysis writes indicators", p1.aangan_decision === "QUALIFIED" && p1.aangan_analysis_status === "COMPLETED" && p1.aangan_call_outcome === "INFORMATION_GIVEN" && p1.aangan_priority === "HIGH" && p1.aangan_sentiment === "NEUTRAL" && p1.aangan_check_budget === "UNCERTAIN", JSON.stringify({ o: p1.aangan_call_outcome, p: p1.aangan_priority }));
  check("1 sync status and last-synced time recorded", p1.aangan_sync_status === "SYNCED" && !!p1.aangan_last_synced_at && !p1.aangan_sync_error);
  check("1 deal placed in Aangan pipeline, amount empty", p1.pipeline === env("HUBSPOT_PIPELINE_ID") && p1.amount === null);
  check("1 contact + one note associated", d1.associations?.contacts?.results?.length === 1 && d1.associations?.notes?.results?.length === 1);
  const n1 = await db.query("select status, attempts, deal_id, note_id from hubspot_sync where enquiry_id=$1", [L.enquiry_id]);
  check("1 Neon sync tracking row written", n1.rows[0]?.status === "synced" && n1.rows[0]?.attempts === 1 && n1.rows[0]?.deal_id === a.result!.dealId);

  // 2. reprocessing the same call creates no duplicates
  const b = await track(L);
  const d2 = await deal(a.result!.dealId, "aangan_decision");
  check("2 reprocess: same deal, no new contact/deal/note", b.result!.dealId === a.result!.dealId && !b.result!.dealCreated && !b.result!.noteCreated && d2.associations?.notes?.results?.length === 1, `notes=${d2.associations?.notes?.results?.length}`);
  // ...even if Neon forgot the ids (crash before they were saved): found again by enquiry id + call marker
  await db.query("delete from hubspot_sync where enquiry_id=$1", [L.enquiry_id]);
  await sleep(6000); // HubSpot search indexes new records a few seconds late
  const b2 = await track(L);
  const d2b = await deal(a.result!.dealId, "aangan_decision");
  check("2 reprocess without remembered ids: still one deal and one note", b2.result!.dealId === a.result!.dealId && d2b.associations?.notes?.results?.length === 1, `notes=${d2b.associations?.notes?.results?.length}`);

  // 3. human decisions are not overwritten
  const stages = JSON.parse(env("HUBSPOT_STAGE_IDS"));
  await hs("PATCH", `/crm/v3/objects/deals/${a.result!.dealId}`, { properties: { dealstage: stages.consult_done, aangan_next_action: "Designer wrote this", aangan_followup_status: "Called, visit fixed", aangan_confirmed_deal_value_inr: "900000", aangan_priority: "LOW" } });
  const c = await track({ ...L, summary: "TEST: updated summary", analysis: { ...L.analysis!, next_action: "AI: a different suggestion", followup_date: "2026-12-01" }, confirmed_deal_value_inr: 1 });
  const d3 = (await deal(a.result!.dealId, "dealstage,aangan_next_action,aangan_followup_status,aangan_confirmed_deal_value_inr,aangan_priority,aangan_call_summary,amount")).properties;
  check("3 human-owned fields untouched (stage, follow-up status, confirmed value, amount)", d3.dealstage === stages.consult_done && d3.aangan_followup_status === "Called, visit fixed" && d3.aangan_confirmed_deal_value_inr === "900000" && d3.amount === null, `stage=${d3.dealstage}`);
  check("3 AI suggestion does not replace a person's next action", d3.aangan_next_action === "Designer wrote this");
  check("3 system fields still refresh (summary, priority recomputed)", d3.aangan_call_summary === "TEST: updated summary" && d3.aangan_priority === "HIGH", `priority=${d3.aangan_priority}`);

  // 4. missing analysis does not erase valid existing information
  const e = await track({ ...L, analysis: { indicators: indicators({ call_status: "completed", analysis: "pending", verdict: null, consult_status: "none", callback_requested: null, sentiment: null }), next_action: null, followup_date: null, url: null } });
  const d4 = (await deal(a.result!.dealId, "aangan_analysis_status,aangan_call_outcome,aangan_priority,aangan_sentiment,aangan_analysis_url,aangan_next_action")).properties;
  check("4 pending analysis keeps existing outcome, priority and link", d4.aangan_call_outcome === "INFORMATION_GIVEN" && d4.aangan_priority === "HIGH" && d4.aangan_analysis_url === "https://example.com/lead" && d4.aangan_next_action === "Designer wrote this", JSON.stringify({ o: d4.aangan_call_outcome, p: d4.aangan_priority }));
  const g = await track({ ...L, analysis: undefined });
  const d4b = (await deal(a.result!.dealId, "aangan_call_outcome,aangan_priority")).properties;
  check("4 no analysis block at all: nothing erased", g.ok && d4b.aangan_call_outcome === "INFORMATION_GIVEN" && d4b.aangan_priority === "HIGH");

  // 5. ambiguous match is flagged, never guessed
  const dupPhone = "+9190001" + String(Date.now()).slice(-5);
  const mkc = (n: string) => hs<any>("POST", "/crm/v3/objects/contacts", { properties: { firstname: "ZZ", lastname: "TEST dup " + n, phone: dupPhone } });
  const [c1, c2] = [await mkc("1"), await mkc("2")]; created.contacts.add(c1.id); created.contacts.add(c2.id);
  for (let i = 0; i < 20; i++) { const s = await hs<any>("POST", "/crm/v3/objects/contacts/search", { filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: dupPhone }] }], limit: 3 }); if (s.results.length === 2) break; await sleep(2000); }
  const A = mk(dupPhone, { email: null });
  const f = await track(A);
  const d5 = await deal(f.result!.dealId, "aangan_sync_status,aangan_sync_error");
  const touched = await hs<any>("GET", `/crm/v3/objects/contacts/${c1.id}?properties=aangan_neon_customer_id`);
  check("5 ambiguous phone: status NEEDS_MATCH_REVIEW", f.result!.status === "NEEDS_MATCH_REVIEW" && d5.properties.aangan_sync_status === "NEEDS_MATCH_REVIEW", d5.properties.aangan_sync_error?.slice(0, 80));
  check("5 not attached to any contact; neither candidate modified", !d5.associations?.contacts?.results?.length && !touched.properties.aangan_neon_customer_id);
  const n5 = await db.query("select status from hubspot_sync where enquiry_id=$1", [A.enquiry_id]);
  check("5 Neon tracking shows needs_match_review", n5.rows[0]?.status === "needs_match_review");

  // 6. failures are tracked safely (redacted), then retried without duplicates
  const good = process.env.HUBSPOT_ACCESS_TOKEN!;
  process.env.HUBSPOT_ACCESS_TOKEN = "pat-na2-00000000-0000-0000-0000-000000000000";
  const F = mk("+9190002" + String(Date.now()).slice(-5));
  await db.query("insert into enquiries (id) values ($1)", [F.enquiry_id]); created.enquiries.add(F.enquiry_id);
  const bad = await runTrackedSync(db, F);
  process.env.HUBSPOT_ACCESS_TOKEN = good;
  const n6 = (await db.query("select status, attempts, last_error from hubspot_sync where enquiry_id=$1", [F.enquiry_id])).rows[0];
  check("6 failed sync recorded as failed", !bad.ok && n6?.status === "failed" && n6.attempts === 1);
  check("6 stored error is redacted (no key)", !!n6?.last_error && !/pat-na2-0000|Bearer \w/.test(n6.last_error), n6?.last_error?.slice(0, 90));
  const r = await retryFailed(db, async (id) => (id === F.enquiry_id ? F : null));
  const n6b = (await db.query("select status, attempts, deal_id, contact_id from hubspot_sync where enquiry_id=$1", [F.enquiry_id])).rows[0];
  if (n6b?.deal_id) created.deals.add(n6b.deal_id);
  if (n6b?.contact_id) created.contacts.add(n6b.contact_id);
  check("6 retry succeeds and clears the failure", r.ok >= 1 && n6b?.status === "synced" && n6b.attempts === 2);
  const again = await runTrackedSync(db, F);
  check("6 repeating the retried sync creates nothing new", again.ok && !again.result!.dealCreated && !again.result!.noteCreated && again.result!.dealId === n6b.deal_id);
} catch (e) {
  check("script ran without an unexpected error", false, e instanceof Error ? e.message.slice(0, 300) : String(e));
} finally {
  for (const id of created.deals) await hs("DELETE", `/crm/v3/objects/deals/${id}`).catch(() => {});
  for (const id of created.contacts) await hs("DELETE", `/crm/v3/objects/contacts/${id}`).catch(() => {});
  // belt and braces: remove any ZZ TEST contact left by search-lag races
  const left = await hs<any>("POST", "/crm/v3/objects/contacts/search", { filterGroups: [{ filters: [{ propertyName: "firstname", operator: "EQ", value: "ZZ" }] }], limit: 50 }).catch(() => ({ results: [] }));
  for (const x of left.results) await hs("DELETE", `/crm/v3/objects/contacts/${x.id}`).catch(() => {});
  for (const id of created.enquiries) await db.query("delete from enquiries where id=$1", [id]);
  await db.end();
  const bad = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - bad}/${results.length} checks passed; test records deleted from HubSpot and Neon`);
}
