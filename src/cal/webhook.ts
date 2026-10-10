import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { hs } from "../hubspot/client.js";
import { redact } from "../util/redact.js";

/**
 * Cal.com booking webhooks. Field names follow Cal.com's documented BOOKING_* payloads but were not verified against a
 * live delivery yet, so parsing is tolerant and anything unrecognised is logged, never guessed.
 */
export type CalStatus = "confirmed" | "pending" | "cancelled" | "rejected";
export interface CalBookingEvent {
  trigger: string; uid: string; rescheduledFromUid: string | null; status: CalStatus;
  start: string | null; end: string | null; title: string | null;
  attendeeEmail: string | null; attendeeName: string | null; attendeeTimeZone: string | null;
  hostEmail: string | null; meetingUrl: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function parseCalEvent(body: any): CalBookingEvent | null {
  const trigger = str(body?.triggerEvent);
  const p = body?.payload;
  if (!trigger || !p || !trigger.startsWith("BOOKING_")) return null;
  const uid = str(p.uid) ?? str(p.bookingUid);
  if (!uid) return null;
  const att = Array.isArray(p.attendees) ? p.attendees[0] : null;
  const status: CalStatus =
    trigger === "BOOKING_CANCELLED" ? "cancelled" : trigger === "BOOKING_REJECTED" ? "rejected" : trigger === "BOOKING_REQUESTED" ? "pending"
    : String(p.status ?? "").toUpperCase() === "PENDING" ? "pending" : "confirmed";
  return {
    trigger, uid, rescheduledFromUid: str(p.rescheduleUid) ?? str(p.rescheduledFromUid), status,
    start: str(p.startTime) ?? str(p.start), end: str(p.endTime) ?? str(p.end), title: str(p.title),
    attendeeEmail: str(att?.email)?.toLowerCase() ?? null, attendeeName: str(att?.name), attendeeTimeZone: str(att?.timeZone),
    hostEmail: str(p.organizer?.email), meetingUrl: str(p.metadata?.videoCallUrl) ?? str(p.videoCallData?.url) ?? str(p.location),
  };
}

/** If Cal.com sends a signature header, it must match HMAC-SHA256(raw body, CAL_WEBHOOK_SECRET). Header name per Cal.com docs: x-cal-signature-256. */
export function signatureOk(raw: Buffer | undefined, header: string | undefined, secret: string | undefined): boolean {
  if (!header) return true; // the secret in the URL is the primary protection; a present-but-wrong signature is rejected
  if (!secret || !raw) return false;
  const want = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(header.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CalRecordResult { matched: boolean; enquiryId: string | null; appointmentId: string; crm: "updated" | "skipped" | "failed" }

export async function recordCalBooking(db: pg.Pool, ev: CalBookingEvent): Promise<CalRecordResult> {
  // Match to an enquiry by the attendee's email (never by name). Prefer the latest live enquiry.
  const enq = ev.attendeeEmail
    ? (await db.query(
        `select e.id from enquiries e join customers c on c.id = e.customer_id
         where lower(c.email) = $1 order by (e.verdict = 'UNQUALIFIED'), e.created_at desc limit 1`, [ev.attendeeEmail])).rows[0]
    : null;
  const enquiryId: string | null = enq?.id ?? null;
  const mode = ev.meetingUrl ? "online" : null;

  // A reschedule arrives as a new booking that points at the old one: update the same row.
  const existing = (await db.query("select id from appointments where cal_booking_uid = any($1::text[]) limit 1", [[ev.uid, ev.rescheduledFromUid ?? ev.uid]])).rows[0];
  const params = [enquiryId, ev.start, ev.end, mode, ev.meetingUrl, ev.status === "confirmed" ? "confirmed" : ev.status === "pending" ? "pending" : "cancelled", ev.uid, ev.status, ev.attendeeEmail, ev.attendeeName, ev.attendeeTimeZone, ev.hostEmail, ev.title];
  const ap = existing
    ? (await db.query(
        `update appointments set enquiry_id = coalesce($1, enquiry_id), starts_at = coalesce($2, starts_at), ends_at = coalesce($3, ends_at), mode = coalesce($4, mode),
           meet_link = coalesce($5, meet_link), status = $6, cal_booking_uid = $7, cal_status = $8, attendee_email = coalesce($9, attendee_email),
           attendee_name = coalesce($10, attendee_name), attendee_timezone = coalesce($11, attendee_timezone), host_email = coalesce($12, host_email), title = coalesce($13, title), updated_at = now()
         where id = $14 returning id`, [...params, existing.id])).rows[0]
    : (await db.query(
        `insert into appointments(enquiry_id, starts_at, ends_at, mode, meet_link, status, cal_booking_uid, cal_status, attendee_email, attendee_name, attendee_timezone, host_email, title)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`, params)).rows[0];

  await db.query("insert into audit_log(actor, event, ref_id, detail) values ('cal-webhook',$1,$2,$3)",
    [enquiryId ? "cal_booking_recorded" : "cal_booking_unmatched", ev.uid, JSON.stringify({ trigger: ev.trigger, status: ev.status, matched: !!enquiryId })]).catch(() => {});

  // Reflect it in HubSpot's system-owned consultation fields only. Never touches deal stage or human-owned fields.
  let crm: CalRecordResult["crm"] = "skipped";
  if (enquiryId && process.env.HUBSPOT_ACCESS_TOKEN) {
    const sync = (await db.query("select deal_id from hubspot_sync where enquiry_id = $1 and deal_id is not null", [enquiryId])).rows[0];
    if (sync && !String(sync.deal_id).startsWith("mock-")) {
      try {
        await hs("PATCH", `/crm/v3/objects/deals/${sync.deal_id}`, { properties: {
          aangan_consult_status: ev.status === "confirmed" ? "confirmed" : ev.status === "pending" ? "pending" : "cancelled",
          ...(ev.start && ev.status !== "cancelled" ? { aangan_consult_time: String(new Date(ev.start).getTime()) } : {}),
          ...(mode ? { aangan_consult_mode: mode } : {}),
        } });
        crm = "updated";
      } catch (e) {
        crm = "failed";
        await db.query("insert into audit_log(actor, event, ref_id, detail) values ('cal-webhook','crm_update_failed',$1,$2)", [ev.uid, JSON.stringify({ error: redact(e instanceof Error ? e.message : String(e)) })]).catch(() => {});
      }
    }
  }
  return { matched: !!enquiryId, enquiryId, appointmentId: ap.id, crm };
}
