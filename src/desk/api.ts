import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import type pg from "pg";
import { optionalEnv } from "../config.js";

/**
 * Backend for the Designer Desk. Access is by a private link: the key travels in a header, only its SHA-256 hash is stored,
 * and a designer's key can read and change only that designer's own leads. A team key (designer_id null) sees everything.
 * Internal value estimates are never selected here.
 */
export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");
export const STAGES = ["new", "contacted", "consult_scheduled", "consult_done", "won", "lost"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Who { keyId: string; designerId: string | null; label: string }

export async function authenticate(db: Pick<pg.Pool, "query">, req: Pick<Request, "header">): Promise<Who | null> {
  const raw = (req.header("x-desk-key") ?? "").trim();
  if (raw.length < 32 || raw.length > 200) return null;
  const r = await db.query("select id, designer_id, label from access_keys where key_hash = $1 and active", [hashKey(raw)]);
  const row = r.rows[0];
  if (!row) return null;
  Promise.resolve(db.query("update access_keys set last_used_at = now() where id = $1", [row.id])).catch(() => {});
  return { keyId: row.id, designerId: row.designer_id, label: row.label };
}

const LEADS_SQL = `
select e.id, e.created_at, d.name as designer_name, c.name as customer_name, c.phone, c.email,
       e.locality, e.city, e.segment, e.property_type, e.area_sqft, e.requirements, e.deadline_text,
       e.verdict, e.criteria, e.notes, e.decline_reason, e.explanation, ca.summary, e.stage,
       ap.starts_at as consult_start, ap.mode as consult_mode, ap.location as consult_location, ap.status as consult_status, ap.meet_link,
       ca.duration_sec as call_duration_sec, hs.deal_id as hubspot_deal_id, hs.status as hubspot_status,
       coalesce((select n.status from notifications n where n.enquiry_id = e.id order by n.created_at desc limit 1), 'none') as email_status
from enquiries e
left join designers d on d.id = e.designer_id
left join customers c on c.id = e.customer_id
left join calls ca on ca.id = e.call_id
left join lateral (select * from appointments a where a.enquiry_id = e.id order by a.created_at desc limit 1) ap on true
left join hubspot_sync hs on hs.enquiry_id = e.id
where ($1::uuid is null or (e.designer_id = $1 and e.verdict in ('QUALIFIED','NEEDS_REVIEW')))
order by e.created_at desc
limit 300`;

const LABELS: Record<string, string> = { real_project: "Real project", service_area: "Location", timeline: "Timeline", budget: "Budget", decision_maker: "Decision-maker" };

export function deskRouter(getDb: () => Pick<pg.Pool, "query">): Router {
  const r = Router();
  r.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  r.get("/leads", async (req, res) => {
    const db = getDb();
    const who = await authenticate(db, req).catch(() => null);
    if (!who) { res.status(401).json({ ok: false, error: "This page needs a private link." }); return; }
    const rows = (await db.query(LEADS_SQL, [who.designerId])).rows;
    const portal = optionalEnv("HUBSPOT_PORTAL_ID"), host = optionalEnv("HUBSPOT_APP_HOST", "app-na2.hubspot.com");
    const leads = rows.map(({ hubspot_deal_id, ...l }: any) => ({
      ...l,
      customer_name: l.customer_name ?? "Unknown caller",
      criteria: (l.criteria ?? []).map((c: any) => ({ ...c, label: LABELS[c.key] ?? c.key })),
      hubspot_url: hubspot_deal_id && portal && !String(hubspot_deal_id).startsWith("mock-") ? `https://${host}/contacts/${portal}/record/0-3/${hubspot_deal_id}` : null,
    }));
    res.json({ ok: true, who: { label: who.label, team: who.designerId === null }, leads });
  });

  // Read-only view for the plain address. Real calls, but no phone, email, links or free-text notes.
  r.get("/public", async (_req, res) => {
    if (optionalEnv("PUBLIC_DESK", "on").toLowerCase() === "off") { res.status(404).json({ ok: false }); return; }
    const rows = (await getDb().query(LEADS_SQL, [null])).rows;
    const leads = rows.map(({ hubspot_deal_id, phone, email, meet_link, notes, hubspot_status, ...l }: any) => ({
      ...l,
      customer_name: l.customer_name ?? "Unknown caller",
      criteria: (l.criteria ?? []).map((c: any) => ({ ...c, label: LABELS[c.key] ?? c.key })),
    }));
    res.json({ ok: true, who: { label: "Studio", team: true }, leads });
  });

  r.post("/leads/:id/stage", async (req, res) => {
    const db = getDb();
    const who = await authenticate(db, req).catch(() => null);
    if (!who) { res.status(401).json({ ok: false }); return; }
    const stage = req.body?.stage;
    if (!UUID.test(req.params.id) || !STAGES.includes(stage)) { res.status(400).json({ ok: false, error: "invalid request" }); return; }
    const u = await db.query("update enquiries set stage = $1, updated_at = now() where id = $2 and ($3::uuid is null or designer_id = $3) returning id", [stage, req.params.id, who.designerId]);
    if (!u.rows[0]) { res.status(404).json({ ok: false }); return; }
    Promise.resolve(db.query("insert into audit_log(actor, event, ref_id, detail) values ($1,'stage_changed',$2,$3)", [`desk:${who.label}`, req.params.id, JSON.stringify({ stage })])).catch(() => {});
    res.json({ ok: true });
  });

  return r;
}
