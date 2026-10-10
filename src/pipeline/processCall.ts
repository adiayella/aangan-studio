import type pg from "pg";
import { extractFacts, summarize, type ExtractedCall } from "../ai/gemini.js";
import { indicators } from "../analysis/indicators.js";
import { optionalEnv } from "../config.js";
import { declineCategory, normalizePhone, validEmail, type SyncLead } from "../hubspot/map.js";
import { syncMode } from "../hubspot/sync.js";
import { runTrackedSync } from "../hubspot/track.js";
import { qualify } from "../qualification/rules.js";
import { estimateValue } from "../value/estimate.js";
import { redact } from "../util/redact.js";
import { notifyEnquiry } from "../email/notify.js";
import { calConfigured, findBookingNear, type Booking } from "../cal/client.js";
import type { EmailLead } from "../email/templates.js";
import type { VaaniEvent } from "../vaani/payload.js";

type Db = pg.Pool;
export type Postprocessing = Extract<VaaniEvent, { kind: "call_postprocessing" }>;

export interface Stage {
  name: string;
  status: "ok" | "skipped" | "failed" | "not_configured" | "pending";
  detail: string;
}
export interface ProcessResult {
  duplicate: boolean;
  callRowId: string | null;
  enquiryId: string | null;
  verdict: string | null;
  stages: Stage[];
}

const audit = (db: Db, event: string, ref: string | null, detail: object) =>
  db.query("insert into audit_log(actor, event, ref_id, detail) values ('pipeline',$1,$2,$3)", [event, ref, JSON.stringify(detail)]).catch(() => {});

/** Records the start of a call (caller id) so the post-call event can find the phone number. */
export async function recordCallStarted(db: Db, callKey: string, phone: string | null) {
  await db.query(
    `insert into calls(provider_call_id, status, started_at, caller_phone) values ($1,'in_progress', now(), $2)
     on conflict (provider_call_id) do update set caller_phone = coalesce(excluded.caller_phone, calls.caller_phone)`,
    [callKey, normalizePhone(phone)],
  );
}

export async function recordCallEnded(db: Db, callKey: string, durationSec: number | null, endReason: string | null) {
  await db.query(
    `insert into calls(provider_call_id, status, duration_sec, end_reason, ended_at, answered) values ($1,'completed',$2,$3,now(),true)
     on conflict (provider_call_id) do update set duration_sec = coalesce($2, calls.duration_sec), end_reason = coalesce($3, calls.end_reason), ended_at = now(), answered = true,
       status = case when calls.status = 'in_progress' then 'completed' else calls.status end`,
    [callKey, durationSec, endReason],
  );
}

/** Least-busy active designer. Returns null when no designers are set up; the lead is then left unassigned, not guessed. */
async function pickDesigner(db: Db): Promise<{ id: string; name: string; email: string } | null> {
  const r = await db.query(
    `select d.id, d.name, d.email from designers d
     left join enquiries e on e.designer_id = d.id and e.stage in ('new','contacted','consult_scheduled')
     where d.active and d.role = 'designer' group by d.id order by count(e.id), d.created_at limit 1`,
  );
  return r.rows[0] ?? null;
}

export async function processPostCall(db: Db, ev: Postprocessing, opts: { syncHubSpot?: boolean; vaaniActualCostInr?: number | null } = {}): Promise<ProcessResult> {
  const stages: Stage[] = [];
  const stage = (name: string, status: Stage["status"], detail: string) => { stages.push({ name, status, detail }); };

  // 1. Save the call and transcript first, so nothing is lost if a later stage fails.
  const existing = (await db.query("select id, analysis_status, caller_phone from calls where provider_call_id=$1", [ev.callKey])).rows[0];
  const dup = existing && (await db.query("select id from enquiries where call_id=$1", [existing.id])).rows[0];
  if (dup) {
    stage("Duplicate check", "skipped", "This call was already processed; nothing was written twice.");
    return { duplicate: true, callRowId: existing.id, enquiryId: dup.id, verdict: null, stages };
  }
  const call = (await db.query(
    `insert into calls(provider_call_id, status, duration_sec, end_reason, transcript, answered, ended_at)
     values ($1,'completed',$2,$3,$4,true,now())
     on conflict (provider_call_id) do update set transcript = coalesce($4, calls.transcript), duration_sec = coalesce($2, calls.duration_sec),
       end_reason = coalesce($3, calls.end_reason), answered = true, status = 'completed'
     returning id, caller_phone`,
    [ev.callKey, ev.durationSec, ev.endReason, ev.transcript],
  )).rows[0];
  stage("Call saved to Neon", "ok", `call ${ev.callKey}, ${ev.durationSec ?? "?"}s, transcript ${ev.transcript ? ev.transcript.length + " chars" : "MISSING"}`);

  if (!ev.transcript) {
    await db.query("update calls set analysis_status='failed', analysis_error='no transcript received' where id=$1", [call.id]);
    stage("Gemini analysis", "failed", "No transcript in the webhook. Marked Failed; can be retried when the transcript is fetched from Vaani.");
    return { duplicate: false, callRowId: call.id, enquiryId: null, verdict: null, stages };
  }

  // 2. Gemini extracts the facts and writes the summary.
  const callDate = (ev.at ?? new Date().toISOString()).slice(0, 10);
  let ex: ExtractedCall, summary: string;
  try {
    [ex, summary] = await Promise.all([extractFacts(ev.transcript, callDate), summarize(ev.transcript)]);
    summary = ev.summary && summary.length < 20 ? ev.summary : summary;
    stage("Gemini analysis", "ok", `extracted facts + summary (${summary.length} chars)`);
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    await db.query("update calls set analysis_status='failed', analysis_error=$2 where id=$1", [call.id, msg]);
    await audit(db, "analysis_failed", ev.callKey, { error: msg });
    stage("Gemini analysis", "failed", `${msg}. Transcript is saved; can be reprocessed.`);
    return { duplicate: false, callRowId: call.id, enquiryId: null, verdict: null, stages };
  }

  // 3. Fixed business rules decide; Gemini never does.
  const q = qualify(ex.facts);
  const est = estimateValue({ ...ex.facts });
  const wantsConsult = (ex.consult_mode !== null || ex.consult_preferred_start !== null) && (q.verdict === "QUALIFIED" || q.verdict === "NEEDS_REVIEW");

  // Find the booking the agent made during this call. It is matched on the slot's start time, NOT on the email the caller gave
  // (voice recognition mishears emails). Either the Cal.com webhook already stored it, or we ask Cal.com directly.
  let booking: Booking | null = null;
  let linkedAppointmentId: string | null = null;
  if (wantsConsult && ex.consult_preferred_start) {
    const callStart = new Date(new Date(ev.at ?? Date.now()).getTime() - (ev.durationSec ?? 0) * 1000 - 10 * 60 * 1000).toISOString();
    const row = (await db.query(
      `select id, cal_booking_uid, starts_at, ends_at, host_email, meet_link, title, attendee_email, attendee_name, attendee_timezone from appointments where enquiry_id is null and cal_booking_uid is not null and cal_status = 'confirmed'
         and abs(extract(epoch from (starts_at - $1::timestamptz))) < 60 and updated_at >= $2 order by updated_at desc limit 1`,
      [ex.consult_preferred_start, callStart])).rows[0];
    if (row) {
      linkedAppointmentId = row.id;
      // Keep the stored booking's details so the designer email and HubSpot show host, time and meeting link.
      booking = { uid: row.cal_booking_uid, id: null, status: "accepted", start: new Date(row.starts_at).toISOString(), end: row.ends_at ? new Date(row.ends_at).toISOString() : "", title: row.title ?? "",
        hostName: null, hostEmail: row.host_email, attendeeEmail: row.attendee_email, attendeeName: row.attendee_name, attendeeTimeZone: row.attendee_timezone, meetingUrl: row.meet_link, description: null, duration: null, createdAt: null };
    }
    else if (calConfigured()) booking = await findBookingNear(ex.consult_preferred_start, callStart, validEmail(ex.caller_email)).catch(() => null);
  }
  const consultStatus: "none" | "pending" | "confirmed" = !wantsConsult ? "none" : booking || linkedAppointmentId ? "confirmed" : "pending";
  const ind = indicators({ call_status: "completed", analysis: "done", verdict: q.verdict, consult_status: consultStatus, callback_requested: ex.callback_requested, sentiment: ex.sentiment });
  stage("Qualification rules", "ok", `${q.verdict}: ${q.explanation}`);
  stage("Internal estimate", est.status === "ESTIMATED" ? "ok" : "skipped", est.status === "ESTIMATED" ? "calculated (internal only, never sent to the caller or designer)" : `${est.status}: ${est.missing.join(", ") || "n/a"}`);

  // 4. Store everything in Neon in one transaction.
  const phone = normalizePhone(call.caller_phone) ?? normalizePhone(ex.caller_phone);
  const email = validEmail(ex.caller_email);
  const designer = q.verdict === "ESCALATION" ? null : await pickDesigner(db);
  const client = await db.connect();
  let enquiryId: string, customerId: string;
  try {
    await client.query("begin");
    const cust = phone
      ? (await client.query(
          `insert into customers(name, phone, email) values ($1,$2,$3)
           on conflict (phone) do update set name = coalesce(customers.name, excluded.name), email = coalesce(excluded.email, customers.email)
           returning id`, [ex.customer_name, phone, email])).rows[0]
      : (await client.query("insert into customers(name, email) values ($1,$2) returning id", [ex.customer_name, email])).rows[0];
    customerId = cust.id;
    const enq = (await client.query(
      `insert into enquiries(call_id, customer_id, designer_id, segment, property_type, locality, city, area_sqft, requirements, deadline_text,
         facts, verdict, criteria, explanation, notes, stage, decline_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'new',$16) returning id`,
      [call.id, customerId, designer?.id ?? null, ex.facts.segment, ex.property_type, ex.facts.locality, ex.facts.city, ex.facts.area_sqft, ex.requirements, ex.deadline_text,
       JSON.stringify(ex.facts), q.verdict, JSON.stringify(q.criteria), q.explanation, q.notes, declineCategory(q)])).rows[0];
    enquiryId = enq.id;
    await client.query(
      `insert into estimates(enquiry_id, status, basis, designed_area_sqft, tier_established, scenarios, pipeline_low_inr, pipeline_high_inr, missing)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [enquiryId, est.status, est.basis, est.designed_area_sqft, est.tier_established, JSON.stringify(est.scenarios), est.pipeline_low_inr, est.pipeline_high_inr, est.missing]);
    if (linkedAppointmentId) {
      // The Cal.com webhook had already stored this booking without an enquiry: attach it now.
      await client.query("update appointments set enquiry_id = $1, designer_id = $2, updated_at = now() where id = $3", [enquiryId, designer?.id ?? null, linkedAppointmentId]);
    } else if (booking) {
      await client.query(
        `insert into appointments(enquiry_id, designer_id, starts_at, ends_at, mode, meet_link, status, cal_booking_uid, cal_status, attendee_email, attendee_name, attendee_timezone, host_email, title)
         values ($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9,$10,$11,$12,$13)
         on conflict (cal_booking_uid) where cal_booking_uid is not null do update set enquiry_id = excluded.enquiry_id, designer_id = excluded.designer_id, updated_at = now()`,
        [enquiryId, designer?.id ?? null, booking.start, booking.end, booking.meetingUrl ? "online" : ex.consult_mode, booking.meetingUrl, booking.uid, booking.status, booking.attendeeEmail, booking.attendeeName, booking.attendeeTimeZone, booking.hostEmail, booking.title]);
    } else if (consultStatus === "pending") {
      const start = ex.consult_preferred_start ? new Date(ex.consult_preferred_start) : null;
      await client.query(
        `insert into appointments(enquiry_id, designer_id, starts_at, ends_at, mode, location, status) values ($1,$2,$3,$4,$5,$6,'pending')`,
        [enquiryId, designer?.id ?? null, start, start ? new Date(start.getTime() + 60 * 60 * 1000) : null, ex.consult_mode, ex.consult_mode === "site_visit" ? ex.facts.locality : null]);
    }
    await client.query("update calls set analysis_status='completed', customer_id=$2, summary=$3 where id=$1", [call.id, customerId, summary]);
    await client.query("insert into audit_log(actor, event, ref_id, detail) values ('pipeline','enquiry_created',$1,$2)", [enquiryId, JSON.stringify({ verdict: q.verdict, criteria: q.criteria.map((c) => `${c.key}:${c.status}`) })]);
    // Cost ledger. Vaani's figure is the dashboard's own per-minute estimate; Gemini's price is not verified, so it is UNAVAILABLE.
    const rate = Number(optionalEnv("VAANI_EST_INR_PER_MIN"));
    if (opts.vaaniActualCostInr != null) {
      await client.query("insert into usage_costs(call_id, provider, units, unit_name, amount_inr, basis, note) values ($1,'vaani',$2,'minutes',$3,'ACTUAL','Vaani billing breakdown for this session')",
        [call.id, ev.durationSec ? ev.durationSec / 60 : null, opts.vaaniActualCostInr]);
    } else if (rate > 0 && ev.durationSec) {
      await client.query("insert into usage_costs(call_id, provider, units, unit_name, amount_inr, basis, note) values ($1,'vaani',$2,'minutes',$3,'ESTIMATED','Vaani dashboard per-minute estimate')",
        [call.id, ev.durationSec / 60, Math.round((ev.durationSec / 60) * rate * 100) / 100]);
    } else {
      await client.query("insert into usage_costs(call_id, provider, basis, note) values ($1,'vaani','UNAVAILABLE','no rate configured or duration missing')", [call.id]);
    }
    await client.query("insert into usage_costs(call_id, provider, basis, note) values ($1,'gemini','UNAVAILABLE','token usage not yet captured; provider price not verified')", [call.id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    const msg = redact(e instanceof Error ? e.message : String(e));
    stage("Save to Neon", "failed", msg);
    return { duplicate: false, callRowId: call.id, enquiryId: null, verdict: q.verdict, stages };
  } finally {
    client.release();
  }
  stage("Enquiry saved to Neon", "ok", `${q.verdict}; designer ${designer?.name ?? "UNASSIGNED (no designers set up yet)"}; ${consultStatus === "confirmed" ? "appointment BOOKED on the calendar (matched by time slot)" : consultStatus === "pending" ? "appointment requested but no booking found, recorded as PENDING" : "no appointment requested"}`);

  // 5. HubSpot.
  let hubspotDealId: string | null = null;
  if (opts.syncHubSpot === false) {
    stage("HubSpot sync", "skipped", "disabled for this run");
  } else {
    const base = optionalEnv("CALL_ANALYSIS_BASE_URL");
    const lead: SyncLead = {
      enquiry_id: enquiryId, customer_id: customerId, call_id: ev.callKey, call_time: ev.at ?? new Date().toISOString(), call_duration_sec: ev.durationSec,
      name: ex.customer_name, phone, email, facts: ex.facts, property_type: ex.property_type, requirements: ex.requirements, deadline_text: ex.deadline_text,
      qualification: q, summary, estimate: est, designer: designer?.name ?? null, stage: "new",
      consult: { status: consultStatus, starts_at: booking?.start ?? ex.consult_preferred_start, mode: booking?.meetingUrl ? "online" : ex.consult_mode },
      analysis: { indicators: ind, next_action: ex.next_action, followup_date: ex.followup_date, url: base ? `${base.replace(/\/$/, "")}/#lead=${enquiryId}` : null },
    };
    const r = await runTrackedSync(db, lead);
    hubspotDealId = r.result && !r.result.mock ? r.result.dealId : null;
    if (!r.ok) stage("HubSpot sync", "failed", `${r.error} (recorded; will be retried)`);
    else if (r.result!.mock) stage("HubSpot sync", "skipped", `MOCK mode: nothing was sent to HubSpot (${syncMode()})`);
    else stage("HubSpot sync", r.result!.status === "SYNCED" ? "ok" : "pending", r.result!.status === "SYNCED" ? `deal ${r.result!.dealId}, ${r.result!.dealCreated ? "created" : "updated"}` : `NEEDS MATCH REVIEW: ${r.result!.review_reason}`);
  }

  // 6. Email the designer (or the founder for an urgent complaint). A failed send is recorded and retried, never silently lost.
  const portal = optionalEnv("HUBSPOT_PORTAL_ID"), host = optionalEnv("HUBSPOT_APP_HOST", "app-na2.hubspot.com"), base2 = optionalEnv("CALL_ANALYSIS_BASE_URL");
  const emailLead: EmailLead = {
    name: ex.customer_name, phone, email, locality: ex.facts.locality, city: ex.facts.city, segment: ex.facts.segment, property_type: ex.property_type,
    area_sqft: ex.facts.area_sqft, designed_area_sqft: ex.facts.designed_area_sqft, requirements: ex.requirements, deadline_text: ex.deadline_text,
    verdict: q.verdict, criteria: q.criteria, explanation: q.explanation, notes: q.notes, summary, designer: designer?.name ?? null, call_time: ev.at ?? new Date().toISOString(),
    consult: { status: consultStatus, starts_at: booking?.start ?? ex.consult_preferred_start, mode: booking?.meetingUrl ? "online" : ex.consult_mode, location: ex.consult_mode === "site_visit" ? ex.facts.locality : null, link: booking?.meetingUrl ?? null, host: booking?.hostEmail ?? null },
    hubspot_url: hubspotDealId && portal ? `https://${host}/contacts/${portal}/record/0-3/${hubspotDealId}` : null,
    analysis_url: base2 ? `${base2.replace(/\/$/, "")}/#lead=${enquiryId}` : null,
  };
  const em = await notifyEnquiry(db, enquiryId, emailLead, designer?.email ?? null);
  stage("Designer email", em.status === "sent" || em.status === "mock" ? (em.status === "mock" ? "skipped" : "ok") : em.status === "failed" ? "failed" : em.status === "not_configured" ? "not_configured" : "skipped", em.detail);
  stage("Appointment on calendar", consultStatus === "confirmed" ? "ok" : consultStatus === "pending" ? "pending" : "skipped", consultStatus === "confirmed" ? `booked in Cal.com for ${booking?.start ?? "the agreed slot"}; the caller was NOT told it is confirmed` : consultStatus === "pending" ? "caller gave a free time but no Cal.com booking was found for it; needs a human" : "no appointment requested");
  await audit(db, "call_processed", ev.callKey, { verdict: q.verdict, stages: stages.map((s) => `${s.name}:${s.status}`) });
  return { duplicate: false, callRowId: call.id, enquiryId, verdict: q.verdict, stages };
}
