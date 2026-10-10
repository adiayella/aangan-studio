// End-to-end check of the LIVE production deployment, in the real order of a call:
//   1. a booking is made in Cal.com (as the voice agent does in the call) -> Cal.com webhook hits production
//   2. Vaani's finished-call events hit production -> Gemini, rubric, Neon, HubSpot, designer email
// The caller's email in the transcript deliberately DIFFERS from the booking's email, to prove matching is by time slot.
// It creates ONE designer email (to the test designer) and ONE HubSpot deal, then deletes/cancels everything it made.
import "../src/config.js";
import pg from "pg";
import { env } from "../src/config.js";
import { bookSlot, cancelBooking, getSlots } from "../src/cal/client.js";
import { hs } from "../src/hubspot/client.js";

const U = "https://aangan-receptionist-one.vercel.app";
const VS = env("VAANI_WEBHOOK_SECRET");
const db = new pg.Pool({ connectionString: env("DATABASE_URL"), max: 2 });
const out: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { out.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = async (b: unknown) => { const r = await fetch(`${U}/webhooks/vaani/${VS}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(60000) }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

const key = "room-FLOW" + Date.now().toString(36);
let bookingUid = "", dealId: string | null = null, contactId: string | null = null, enquiryId: string | null = null;
try {
  // 1. Booking made "during the call"
  const slots = await getSlots(new Date(Date.now() + 4 * 3600e3).toISOString(), new Date(Date.now() + 8 * 86400e3).toISOString());
  const slot = slots[Math.min(40, slots.length - 1)];
  const b = await bookSlot({ startISO: slot.startUtc, name: "ZZ Flow Test", email: "ayella.adwaith+flowtest@gmail.com", timeZone: "Asia/Kolkata", title: "FLOW TEST", notes: "FLOW TEST booking, safe to ignore (created by scripts/prod-flow-check.ts)", metadata: { source: "prod-flow-check" } });
  if (!b.ok) throw new Error("test booking failed: " + b.detail);
  bookingUid = b.booking.uid;
  check("test booking made in Cal.com", ["accepted", "confirmed"].includes(b.booking.status.toLowerCase()), `${istDay(slot.startUtc)} ${istTime(slot.startUtc)} IST, status ${b.booking.status}`);
  await sleep(12000); // let Cal.com's BOOKING_CREATED webhook reach production
  const w = (await db.query("select enquiry_id is null as unmatched, status from appointments where cal_booking_uid=$1", [bookingUid])).rows[0];
  check("Cal.com webhook reached production and stored the booking", !!w && w.status === "confirmed" && w.unmatched === true, w ? `stored as ${w.status}, not yet matched to an enquiry (correct: the call has not finished)` : "no row found");

  // 2. The finished call arrives from Vaani
  const transcript = `AGENT: Hello! Thank you for calling Aangan Studio. I am the studio's AI assistant. How can I help you with your interior design project today?
USER: Hi, I have a 3BHK flat in Baner, about 1200 square feet. I want a complete redesign with full execution, finished in about six months. I am the owner.
AGENT: That sounds wonderful. Would you like me to arrange an appointment to discuss your project? Which day and time are you free?
USER: I am free on ${istDay(slot.startUtc)} at ${istTime(slot.startUtc)} India time.
AGENT: May I have your full name, phone number and email?
USER: My name is ZZ Flow Test. My number is nine zero zero zero zero zero zero zero three three. My email is zz dot flowtest at gmail dot com.
AGENT: Thank you. I have noted that. Our team will confirm the appointment with you shortly.`;
  const started = await post({ event: "call_started", room_name: key, phone_number: "+919000000033" });
  const ended = await post({ event: "call_ended", room_name: key, call_duration: 120, end_reason: "agent_hangup" });
  check("call_started and call_ended accepted", started.status === 200 && ended.status === 200);
  const t0 = Date.now();
  const pp = await post({ event: "call_postprocessing", call_id: key, timestamp: new Date().toISOString(), data: { room_name: key, call_id: key, call_duration: 120000, end_reason: "agent_hangup", summary: "", transcript } });
  check("call_postprocessing processed by production", pp.status === 200 && pp.body.ok && pp.body.verdict === "QUALIFIED" && pp.body.failed?.length === 0, `HTTP ${pp.status}, verdict ${pp.body.verdict}, failed stages: ${JSON.stringify(pp.body.failed)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const e = (await db.query(`select e.id, e.verdict, d.name designer, (e.facts->>'caller_email') fe from enquiries e join calls ca on ca.id=e.call_id left join designers d on d.id=e.designer_id where ca.provider_call_id=$1`, [key])).rows;
  enquiryId = e[0]?.id ?? null;
  check("exactly one enquiry stored, assigned to the test designer", e.length === 1 && e[0].designer === "Test Designer", `${e.length} enquiry, designer ${e[0]?.designer}`);
  const a = (await db.query("select status, cal_booking_uid, attendee_email from appointments where enquiry_id=$1", [enquiryId])).rows;
  check("booking linked by TIME SLOT despite the wrong email", a.length === 1 && a[0].cal_booking_uid === bookingUid && a[0].status === "confirmed", a[0] ? `booking email on file: ${a[0].attendee_email} (caller said a different one)` : "no appointment linked");
  const n = (await db.query("select status, recipient, provider_id, payload->>'subject' subj, payload->>'text' txt from notifications where enquiry_id=$1", [enquiryId])).rows[0];
  check("designer email sent", n?.status === "sent" && n.recipient === "ayella.adwaith@gmail.com", n ? `to ${n.recipient}` : "none");
  if (n?.provider_id) { await sleep(5000); const r = await (await fetch("https://api.resend.com/emails/" + n.provider_id, { headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` } })).json() as any; check("Resend reports the email delivered", r.last_event === "delivered", `last_event ${r.last_event}`); }
  check("email says the calendar is BOOKED and the customer was not told", /BOOKED on the calendar of/.test(n?.txt ?? "") && /NOT been told/.test(n?.txt ?? ""));
  check("email contains no price or estimate", !/₹|\blakh\b|per sq|estimate|INDICATIVE|quotation/i.test(n?.txt ?? ""));
  const h = (await db.query("select deal_id, contact_id, status from hubspot_sync where enquiry_id=$1", [enquiryId])).rows[0];
  dealId = h?.deal_id ?? null; contactId = h?.contact_id ?? null;
  if (dealId) {
    const d = (await hs<any>("GET", `/crm/v3/objects/deals/${dealId}?properties=aangan_decision,aangan_consult_status,aangan_call_outcome,aangan_sync_status,aangan_designer,amount&associations=notes,contacts`)).properties;
    check("HubSpot deal: qualified, consultation confirmed, outcome booked", d.aangan_decision === "QUALIFIED" && d.aangan_consult_status === "confirmed" && d.aangan_call_outcome === "CONSULTATION_BOOKED" && d.aangan_sync_status === "SYNCED", JSON.stringify({ decision: d.aangan_decision, consult: d.aangan_consult_status, outcome: d.aangan_call_outcome }));
    check("HubSpot deal amount left empty (no estimate leaked)", d.amount === null);
  } else check("HubSpot deal created", false, `hubspot_sync status ${h?.status}`);

  // 3. Same event again
  const dup = await post({ event: "call_postprocessing", call_id: key, timestamp: new Date().toISOString(), data: { room_name: key, call_id: key, call_duration: 120000, transcript } });
  const cnt = (await db.query("select (select count(*)::int from enquiries e join calls ca on ca.id=e.call_id where ca.provider_call_id=$1) enq, (select count(*)::int from notifications where enquiry_id=$2) notif, (select count(*)::int from appointments where enquiry_id=$2) appt", [key, enquiryId])).rows[0];
  check("repeated event creates nothing new", dup.body.duplicate === true && cnt.enq === 1 && cnt.notif === 1 && cnt.appt === 1, `enquiries ${cnt.enq}, emails ${cnt.notif}, appointments ${cnt.appt}`);
} catch (e) {
  check("script ran without an unexpected error", false, e instanceof Error ? e.message.slice(0, 250) : String(e));
} finally {
  // cleanup everything this check created
  if (bookingUid) { await cancelBooking(bookingUid, "flow check cleanup").catch(() => {}); await sleep(8000); }
  if (dealId) await hs("DELETE", `/crm/v3/objects/deals/${dealId}`).catch(() => {});
  if (contactId) await hs("DELETE", `/crm/v3/objects/contacts/${contactId}`).catch(() => {});
  if (bookingUid) await db.query("delete from appointments where cal_booking_uid=$1", [bookingUid]);
  if (enquiryId) await db.query("delete from enquiries where id=$1", [enquiryId]);
  const c = (await db.query("select id, customer_id from calls where provider_call_id=$1", [key])).rows[0];
  if (c) { await db.query("delete from calls where id=$1", [c.id]); if (c.customer_id) await db.query("delete from customers x where x.id=$1 and not exists (select 1 from enquiries q where q.customer_id=x.id)", [c.customer_id]); }
  await db.query("delete from audit_log where ref_id = any($1::text[])", [[key, bookingUid].filter(Boolean)]).catch(() => {});
  await db.end();
  const bad = out.filter((r) => !r[1]).length;
  console.log(`\n${out.length - bad}/${out.length} checks passed. Test booking cancelled; test deal, contact and rows deleted.`);
}
