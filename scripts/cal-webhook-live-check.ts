// Live check of the Cal.com booking recorder against Neon using a temporary test customer. HubSpot is skipped. Cleans up.
import "../src/config.js";
process.env.HUBSPOT_ACCESS_TOKEN = "";
const { db, closeDb } = await import("../src/db/pool.js");
const { parseCalEvent, recordCalBooking } = await import("../src/cal/webhook.js");
const email = "zz.cal.webhook.test@example.com";
const c = (await db().query("insert into customers(name,email) values ('ZZ TEST Cal Webhook',$1) returning id", [email])).rows[0];
const e = (await db().query("insert into enquiries(customer_id, verdict, stage) values ($1,'QUALIFIED','new') returning id", [c.id])).rows[0];
const mk = (trigger: string, uid: string, extra: object = {}, status = "ACCEPTED") => parseCalEvent({ triggerEvent: trigger, payload: { uid, status, title: "TEST", startTime: "2026-10-20T09:30:00Z", endTime: "2026-10-20T10:00:00Z", attendees: [{ name: "ZZ", email: email.toUpperCase(), timeZone: "Asia/Kolkata" }], organizer: { email: "host@x.com" }, metadata: { videoCallUrl: "https://app.cal.com/video/t" }, ...extra } })!;
const out: string[] = []; const ok = (n: string, v: boolean, d = "") => { out.push(`${v ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
try {
  const r1 = await recordCalBooking(db(), mk("BOOKING_CREATED", "ZZUID1"));
  ok("booking matched to the enquiry by attendee email", r1.matched && r1.enquiryId === e.id);
  const r1b = await recordCalBooking(db(), mk("BOOKING_CREATED", "ZZUID1"));
  const n = (await db().query("select count(*)::int n, max(status) s from appointments where cal_booking_uid='ZZUID1'")).rows[0];
  ok("same event delivered twice -> one appointment", n.n === 1 && r1b.appointmentId === r1.appointmentId, `rows=${n.n}`);
  ok("stored as confirmed", n.s === "confirmed");
  await recordCalBooking(db(), mk("BOOKING_RESCHEDULED", "ZZUID2", { rescheduleUid: "ZZUID1", startTime: "2026-10-21T09:30:00Z", endTime: "2026-10-21T10:00:00Z" }));
  const n2 = (await db().query("select count(*)::int n, max(starts_at)::text t, max(cal_booking_uid) u from appointments where cal_booking_uid in ('ZZUID1','ZZUID2')")).rows[0];
  ok("reschedule updates the same appointment, no duplicate", n2.n === 1 && n2.u === "ZZUID2" && /2026-10-21/.test(n2.t), `rows=${n2.n}, start=${n2.t}`);
  await recordCalBooking(db(), mk("BOOKING_CANCELLED", "ZZUID2"));
  ok("cancellation recorded", (await db().query("select status from appointments where cal_booking_uid='ZZUID2'")).rows[0].status === "cancelled");
  const un = await recordCalBooking(db(), parseCalEvent({ triggerEvent: "BOOKING_CREATED", payload: { uid: "ZZUID9", status: "ACCEPTED", startTime: "2026-10-22T09:30:00Z", endTime: "2026-10-22T10:00:00Z", attendees: [{ name: "Nobody", email: "nobody.zz@example.com", timeZone: "Asia/Kolkata" }] } })!);
  ok("unknown attendee is stored as unmatched, not attached to a guess", !un.matched && un.enquiryId === null);
  ok("unmatched booking flagged in audit log", (await db().query("select count(*)::int n from audit_log where event='cal_booking_unmatched' and ref_id='ZZUID9'")).rows[0].n === 1);
} finally {
  await db().query("delete from appointments where cal_booking_uid like 'ZZUID%'");
  await db().query("delete from audit_log where ref_id like 'ZZUID%'");
  await db().query("delete from enquiries where id=$1", [e.id]); await db().query("delete from customers where id=$1", [c.id]);
  console.log(out.join("\n")); await closeDb();
}
