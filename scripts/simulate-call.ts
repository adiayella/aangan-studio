// Replays a finished call through the real pipeline (Gemini -> rules -> Neon -> HubSpot) and prints every stage.
// Usage: npx tsx scripts/simulate-call.ts <T01..T20 | chat-wakad | chat-complaint> [--live-hubspot] [--keep]
//   default: HubSpot is MOCK (nothing sent) and the test rows are deleted afterwards.
import { readFileSync } from "node:fs";
import "../src/config.js";

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) ?? "T01";
const live = args.includes("--live-hubspot");
const keep = args.includes("--keep");
process.env.HUBSPOT_SYNC_MODE = live ? "live" : "mock";
// Simulations never send real email unless asked: --live-email
process.env.EMAIL_MODE = args.includes("--live-email") ? "live" : "mock";
if (args.includes("--live-email")) process.env.EMAIL_SUBJECT_PREFIX = "[TEST — simulated call] ";
const showEmail = args.includes("--show-email");

const { db, closeDb } = await import("../src/db/pool.js");
const { processPostCall, recordCallStarted, recordCallEnded } = await import("../src/pipeline/processCall.js");
const { parseVaaniEvent } = await import("../src/vaani/payload.js");
const { hs } = await import("../src/hubspot/client.js");

const CHATS: Record<string, string> = {
  "chat-wakad": `AGENT: Hello! Thank you for calling Aangan Studio. I'm the studio's AI assistant. How can I help you with your interior design project today?
USER: Hi, I have a 2BHK in Wakad, about 950 sq ft. How much per square foot do you charge? Even a rough range please.
AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like. Is the property ready for work, or are you waiting on possession?
USER: It's empty, we got possession. We want a full redesign, kitchen, wardrobes and both bedrooms, done by March. I'm the owner. My name is Rahul Verma. I'd like a site visit on 14 October at 5 pm.
AGENT: I've noted your preferred time. Our team will confirm a slot with a designer, and you'll receive a calendar invitation by email once it's confirmed. May I have your email address?
USER: rahul dot verma at gmail dot com
AGENT: Thank you Rahul. Thank you for calling Aangan Studio. Have a wonderful day.`,
  "chat-complaint": `AGENT: Hello! Thank you for calling Aangan Studio. I'm the studio's AI assistant. How can I help you today?
USER: I need to speak to someone right now. My project has been going for three months and my designer Aryan hasn't replied in five days. This is not acceptable. I'm Sheetal, my flat is in Viman Nagar.
AGENT: I completely understand your frustration, Sheetal, and I am very sorry. Could you confirm the best phone number to reach you at, and would you like a senior person to call you back?
USER: Yes, a senior person or Nikhil please, call me back on this number.
AGENT: I'm escalating this to the studio team right now, and someone senior will call you back.`,
};

let transcript = CHATS[which];
let callDate = new Date().toISOString().slice(0, 10) + "T10:00:00+05:30";
if (!transcript) {
  const txt = readFileSync("tests/fixtures/phone-transcripts.txt", "utf8");
  const block = txt.split(/\n(?=T\d\d · Phone)/).find((b) => b.startsWith(which));
  if (!block) { console.error(`Unknown scenario "${which}"`); process.exit(1); }
  transcript = block.replace(/Front Desk:/g, "AGENT:").replace(/Caller:/g, "USER:");
  const day = /(\d+) September/.exec(block)?.[1] ?? "1";
  callDate = `2026-09-${day.padStart(2, "0")}T10:00:00+05:30`;
}

const key = "room-SIM" + Date.now().toString(36);
const phone = "+9190" + String(Date.now()).slice(-8);
console.log(`\n=== Simulated call ${key} (${which}) — HubSpot ${live ? "LIVE" : "MOCK"} ===\n`);
console.log("1. Vaani sends call_started  ->", `phone ${phone}`);
await recordCallStarted(db(), key, phone);
console.log("2. Vaani sends call_ended    -> 187 s");
await recordCallEnded(db(), key, 187, "agent_hangup");
console.log("3. Vaani sends call_postprocessing (transcript + summary)\n");
const ev = parseVaaniEvent({ event: "call_postprocessing", call_id: key, timestamp: callDate, data: { room_name: key, call_id: key, call_duration: 187000, end_reason: "agent_hangup", summary: "", transcript, entities: {}, dispositions: {} } });
if (ev.kind !== "call_postprocessing") throw new Error("bad event");

const r = await processPostCall(db(), ev);
const icon: Record<string, string> = { ok: "OK     ", skipped: "SKIPPED", failed: "FAILED ", not_configured: "NOT SET", pending: "PENDING" };
for (const s of r.stages) console.log(`  [${icon[s.status]}] ${s.name}: ${s.detail}`);

if (r.enquiryId) {
  const row = (await db().query(
    `select c.name, c.phone, c.email, e.verdict, e.explanation, e.criteria, e.locality, e.city, e.stage, d.name as designer,
            es.status as est_status, a.status as consult_status, a.mode, a.starts_at, ca.analysis_status
     from enquiries e join customers c on c.id = e.customer_id join calls ca on ca.id = e.call_id
     left join designers d on d.id = e.designer_id left join estimates es on es.enquiry_id = e.id left join appointments a on a.enquiry_id = e.id
     where e.id = $1`, [r.enquiryId])).rows[0];
  console.log("\n  What is now in Neon:");
  console.log(`    customer   ${row.name ?? "(name not captured)"} | ${row.phone} | ${row.email ?? "no email"}`);
  console.log(`    location   ${[row.locality, row.city].filter(Boolean).join(", ") || "unknown"}`);
  console.log(`    verdict    ${row.verdict}`);
  for (const c of row.criteria) console.log(`      ${String(c.status).toUpperCase().padEnd(8)} ${c.key}: ${c.reason}`);
  console.log(`    estimate   ${row.est_status} (internal only)`);
  console.log(`    consult    ${row.consult_status ?? "none"} ${row.mode ?? ""} ${row.starts_at ? new Date(row.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : ""}`);
  console.log(`    designer   ${row.designer ?? "unassigned"}`);
}

if (showEmail && r.enquiryId) {
  const n = (await db().query("select kind, recipient, status, payload from notifications where enquiry_id=$1", [r.enquiryId])).rows[0];
  if (n) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync("docs/email-preview.html", n.payload.html);
    console.log(`\n  --- EMAIL (${n.kind}, recipient ${n.recipient}, status ${n.status}) ---\n  Subject: ${n.payload.subject}\n`);
    console.log(n.payload.text.split("\n").map((l: string) => "  | " + l).join("\n"));
    console.log("\n  HTML preview written to docs/email-preview.html");
  } else console.log("\n  (no email for this verdict)");
}

// Second delivery of the same event must change nothing.
const again = await processPostCall(db(), ev);
console.log(`\n  Same event delivered again -> ${again.duplicate ? "ignored as duplicate (nothing written twice)" : "NOT detected as duplicate!"}`);

if (!keep) {
  const sync = r.enquiryId ? (await db().query("select deal_id, contact_id from hubspot_sync where enquiry_id=$1", [r.enquiryId])).rows[0] : null;
  if (live && sync?.deal_id) await hs("DELETE", `/crm/v3/objects/deals/${sync.deal_id}`).catch(() => {});
  if (live && sync?.contact_id) await hs("DELETE", `/crm/v3/objects/contacts/${sync.contact_id}`).catch(() => {});
  if (r.enquiryId) await db().query("delete from enquiries where id=$1", [r.enquiryId]);
  const cid = (await db().query("select customer_id from calls where id=$1", [r.callRowId])).rows[0]?.customer_id;
  await db().query("delete from calls where id=$1", [r.callRowId]);
  if (cid) await db().query("delete from customers c where c.id=$1 and not exists (select 1 from enquiries e where e.customer_id=c.id)", [cid]);
  console.log("\n  (test rows deleted; run with --keep to leave them for inspection)");
}
await closeDb();
