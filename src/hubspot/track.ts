import type pg from "pg";
import { redact } from "../util/redact.js";
import { syncEnquiry, type SyncResult } from "./sync.js";
import type { SyncLead } from "./map.js";

type Db = Pick<pg.Pool | pg.Client, "query">;

/**
 * Runs one sync and records the outcome in Neon. Known HubSpot ids are loaded first, so a retry
 * updates the same records instead of creating new ones. Errors are stored redacted.
 */
export async function runTrackedSync(db: Db, lead: SyncLead): Promise<{ ok: boolean; result?: SyncResult; error?: string }> {
  const prev = (await db.query("select contact_id, deal_id, note_id from hubspot_sync where enquiry_id = $1", [lead.enquiry_id])).rows[0];
  const withIds: SyncLead = {
    ...lead,
    hubspot_contact_id: lead.hubspot_contact_id ?? prev?.contact_id ?? null,
    hubspot_deal_id: lead.hubspot_deal_id ?? prev?.deal_id ?? null,
    hubspot_note_id: lead.hubspot_note_id ?? prev?.note_id ?? null,
  };
  try {
    const r = await syncEnquiry(withIds);
    if (r.mock) {
      // Mock mode sends nothing, so it must never be recorded as synced and must not store its fake ids.
      await db.query(
        `insert into hubspot_sync (enquiry_id, status, attempts, last_error, updated_at) values ($1,'pending',0,'MOCK mode: nothing was sent to HubSpot',now())
         on conflict (enquiry_id) do update set status = 'pending', last_error = 'MOCK mode: nothing was sent to HubSpot', updated_at = now()`,
        [lead.enquiry_id]);
      return { ok: true, result: r };
    }
    const status = r.status === "SYNCED" ? "synced" : "needs_match_review";
    await db.query(
      `insert into hubspot_sync (enquiry_id, contact_id, deal_id, note_id, status, attempts, last_error, review_reason, last_synced_at, updated_at)
       values ($1,$2,$3,$4,$5,1,null,$6,now(),now())
       on conflict (enquiry_id) do update set contact_id = coalesce($2, hubspot_sync.contact_id), deal_id = $3, note_id = $4,
         status = $5, attempts = hubspot_sync.attempts + 1, last_error = null, review_reason = $6, last_synced_at = now(), updated_at = now()`,
      [lead.enquiry_id, r.contactId, r.dealId, r.noteId, status, r.review_reason ? redact(r.review_reason) : null],
    );
    return { ok: true, result: r };
  } catch (e) {
    const error = redact(e instanceof Error ? e.message : String(e));
    await db.query(
      `insert into hubspot_sync (enquiry_id, status, attempts, last_error, updated_at) values ($1,'failed',1,$2,now())
       on conflict (enquiry_id) do update set status = 'failed', attempts = hubspot_sync.attempts + 1, last_error = $2, updated_at = now()`,
      [lead.enquiry_id, error],
    );
    return { ok: false, error };
  }
}

/** Retries every failed sync (at most `maxAttempts` tries each). `load` rebuilds the lead from Neon. */
export async function retryFailed(db: Db, load: (enquiryId: string) => Promise<SyncLead | null>, maxAttempts = 6) {
  const rows = (await db.query("select enquiry_id from hubspot_sync where status = 'failed' and attempts < $1 order by updated_at limit 25", [maxAttempts])).rows;
  let ok = 0, failed = 0;
  for (const r of rows) {
    const lead = await load(r.enquiry_id);
    if (!lead) continue;
    (await runTrackedSync(db, lead)).ok ? ok++ : failed++;
  }
  return { tried: rows.length, ok, failed };
}
