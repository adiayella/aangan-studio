import type pg from "pg";
import { redact } from "../util/redact.js";
import { sendEmail } from "./resend.js";
import { renderDesignerEmail, type EmailLead, type Rendered } from "./templates.js";

type Db = pg.Pool;
export type NotifyOutcome = { status: "sent" | "failed" | "skipped" | "not_configured" | "mock"; detail: string };

export type Kind = "designer_handoff" | "urgent_escalation";

/**
 * Who gets the email. Only a QUALIFIED / NEEDS_REVIEW lead with an assigned designer is emailed. The founder uses the dashboard,
 * so urgent complaints and unassigned leads are NOT emailed to anyone: they appear on the dashboard and in HubSpot instead.
 */
export function chooseRecipient(verdict: EmailLead["verdict"], designerEmail: string | null): { kind: Kind; to: string | null; note: string } | null {
  if (verdict === "ESCALATION") return { kind: "urgent_escalation", to: null, note: "Urgent complaint: shown as Urgent on the dashboard and in HubSpot; no email by design." };
  if (verdict === "QUALIFIED" || verdict === "NEEDS_REVIEW") {
    if (designerEmail) return { kind: "designer_handoff", to: designerEmail, note: "assigned designer" };
    return { kind: "designer_handoff", to: null, note: "No designer assigned: the lead is on the dashboard as Unassigned; no email sent." };
  }
  return null; // unqualified: nothing to hand over
}

/**
 * Sends (or retries) the email for one enquiry and records the outcome. The rendered email is stored so a failed
 * send can be retried exactly as it was. Never throws: a failure is recorded, not lost.
 */
export async function notifyEnquiry(db: Db, enquiryId: string, lead: EmailLead, designerEmail: string | null): Promise<NotifyOutcome> {
  const pick = chooseRecipient(lead.verdict, designerEmail);
  if (!pick) return { status: "skipped", detail: "not applicable for this verdict" };
  const mail = renderDesignerEmail(lead);

  const prev = (await db.query("select status from notifications where enquiry_id=$1 and kind=$2", [enquiryId, pick.kind])).rows[0];
  if (prev?.status === "sent") return { status: "skipped", detail: "already sent; not sent twice" };

  if (!pick.to) {
    // Recorded as skipped (not failed), so it is visible but never retried: the dashboard is where these are handled.
    await db.query(
      `insert into notifications(enquiry_id, kind, recipient, status, attempts, last_error, payload) values ($1,$2,'(none)','skipped',0,$3,$4)
       on conflict (enquiry_id, kind) do update set status='skipped', last_error=$3, payload=$4`,
      [enquiryId, pick.kind, pick.note, JSON.stringify(mail)]);
    return { status: "skipped", detail: pick.note };
  }
  return deliver(db, enquiryId, pick.kind, pick.to, mail, pick.note);
}

async function deliver(db: Db, enquiryId: string, kind: Kind, to: string, mail: Rendered, note: string): Promise<NotifyOutcome> {
  await db.query(
    `insert into notifications(enquiry_id, kind, recipient, status, attempts, payload) values ($1,$2,$3,'queued',0,$4)
     on conflict (enquiry_id, kind) do update set recipient=$3, status='queued', payload=$4`,
    [enquiryId, kind, to, JSON.stringify(mail)]);
  const r = await sendEmail(to, mail, `${kind}-${enquiryId}`);
  if (r.ok && r.mock) {
    await db.query("update notifications set status='skipped', last_error='MOCK mode: nothing was sent', attempts=0 where enquiry_id=$1 and kind=$2", [enquiryId, kind]);
    return { status: "mock", detail: `MOCK, nothing sent: to ${r.to} (${note})` };
  }
  if (r.ok) {
    await db.query("update notifications set status='sent', attempts=attempts+1, last_error=null, provider_id=$3, sent_at=now() where enquiry_id=$1 and kind=$2", [enquiryId, kind, r.id ?? (r.mock ? "mock" : null)]);
    return { status: r.mock ? "mock" : "sent", detail: `${r.mock ? "MOCK, nothing sent: " : ""}to ${r.to}${r.redirected ? ` (test redirect; intended ${to})` : ""} (${note})` };
  }
  await db.query("update notifications set status='failed', attempts=attempts+1, last_error=$3 where enquiry_id=$1 and kind=$2", [enquiryId, kind, r.error ?? "unknown"]);
  return { status: "failed", detail: `${r.error} (recorded; will be retried)` };
}

/** Retries failed emails exactly as stored. Run on a schedule. */
export async function retryFailedEmails(db: Db, maxAttempts = 6) {
  const rows = (await db.query("select enquiry_id, kind, recipient, payload from notifications where status='failed' and attempts < $1 and recipient <> '(none)' limit 25", [maxAttempts])).rows;
  let ok = 0, failed = 0;
  for (const r of rows) ((await deliver(db, r.enquiry_id, r.kind, r.recipient, r.payload, "retry")).status === "failed" ? failed++ : ok++);
  return { tried: rows.length, ok, failed };
}
export { redact };
