// Read-only health check of every integration. Sends no email, books nothing, writes nothing.
// Usage: npx tsx scripts/health-check.ts
import "../src/config.js";
import pg from "pg";
import { env, optionalEnv } from "../src/config.js";

const rows: [string, "OK" | "FAIL" | "WARN", string][] = [];
const add = (n: string, s: "OK" | "FAIL" | "WARN", d: string) => { rows.push([n, s, d]); console.log(`${s.padEnd(4)}  ${n.padEnd(34)} ${d}`); };
const t = async (n: string, f: () => Promise<[("OK" | "FAIL" | "WARN"), string]>) => { try { const [s, d] = await f(); add(n, s, d); } catch (e) { add(n, "FAIL", (e instanceof Error ? e.message : String(e)).slice(0, 160).replace(/(pat-[\w-]+|re_\w+|cal_\w+|AQ\.[\w-]+)/g, "[key]")); } };
const j = async (url: string, init: RequestInit) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); return { r, body: await r.json().catch(() => null) as any }; };

// Neon
const db = new pg.Pool({ connectionString: env("DATABASE_URL"), max: 1 });
await t("Neon database connects", async () => { const r = await db.query("select count(*)::int n from information_schema.tables where table_schema='public'"); return ["OK", `${r.rows[0].n} tables`]; });
await t("Neon migrations applied", async () => { const r = await db.query("select count(*)::int n, max(name) m from schema_migrations"); return [r.rows[0].n >= 6 ? "OK" : "FAIL", `${r.rows[0].n} applied, latest ${r.rows[0].m}`]; });
await t("Knowledge base has no prices", async () => {
  const r = await db.query("select topic, content from kb_entries"); const bad = r.rows.filter((x) => /₹|\blakh\b|per sq|rate of/i.test(x.content));
  return [bad.length ? "FAIL" : "OK", `${r.rowCount} entries, ${bad.length} contain price wording`];
});
await t("Designer exists for routing", async () => { const r = await db.query("select count(*)::int n from designers where active"); return [r.rows[0].n > 0 ? "OK" : "WARN", `${r.rows[0].n} active designer(s)`]; });
await t("Leftover test rows in Neon", async () => {
  const r = await db.query("select (select count(*)::int from calls where provider_call_id like 'room-SIM%' or provider_call_id like 'room-HTTP%') sim, (select count(*)::int from enquiries) enq");
  return [r.rows[0].sim ? "WARN" : "OK", `${r.rows[0].sim} simulated call(s) kept, ${r.rows[0].enq} enquiries total`];
});
await t("Auth: sign-in service reachable", async () => { const { r } = await j("https://ep-purple-recipe-b574hdyn.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/ok", {}); return [r.ok ? "OK" : "FAIL", `HTTP ${r.status}`]; });
await t("Auth: a designer login user is linked", async () => { const r = await db.query("select count(*)::int n from designers where auth_user_id is not null"); return [r.rows[0].n > 0 ? "OK" : "WARN", `${r.rows[0].n} designer(s) linked to a sign-in user`]; });
await db.end();

// Gemini
await t("Gemini responds", async () => {
  const { r } = await j(`https://generativelanguage.googleapis.com/v1beta/models/${optionalEnv("GEMINI_MODEL", "gemini-3.8-flash")}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "Reply: ok" }] }] }) });
  return [r.ok ? "OK" : "FAIL", `model ${optionalEnv("GEMINI_MODEL")}, HTTP ${r.status}`];
});

// HubSpot
const hh = { Authorization: `Bearer ${env("HUBSPOT_ACCESS_TOKEN")}` };
await t("HubSpot key works", async () => { const { r, body } = await j("https://api.hubapi.com/account-info/v3/details", { headers: hh }); return [r.ok && String(body.portalId) === optionalEnv("HUBSPOT_PORTAL_ID") ? "OK" : "FAIL", `portal ${body?.portalId}, currency ${body?.companyCurrency}`]; });
await t("HubSpot pipeline + fields exist", async () => {
  const p = await j(`https://api.hubapi.com/crm/v3/pipelines/deals/${env("HUBSPOT_PIPELINE_ID")}`, { headers: hh });
  const f = await j("https://api.hubapi.com/crm/v3/properties/deals", { headers: hh });
  const n = (f.body?.results ?? []).filter((x: any) => String(x.name).startsWith("aangan_")).length;
  return [p.r.ok && n >= 40 ? "OK" : "FAIL", `${p.body?.stages?.length ?? 0} stages, ${n} Aangan deal fields`];
});
await t("HubSpot currency is INR", async () => { const { body } = await j("https://api.hubapi.com/account-info/v3/details", { headers: hh }); return [body?.companyCurrency === "INR" ? "OK" : "WARN", `currently ${body?.companyCurrency}; rupee amounts are stored in INR fields regardless`]; });

// Resend
await t("Resend key works", async () => { const { r, body } = await j("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` } }); return [r.ok ? "OK" : "FAIL", `${body?.data?.length ?? 0} verified domain(s); mode ${optionalEnv("EMAIL_MODE") || "auto"}`]; });
await t("Resend: can email designers", async () => { const { body } = await j("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` } }); return [(body?.data?.length ?? 0) > 0 ? "OK" : "WARN", (body?.data?.length ?? 0) > 0 ? "domain verified" : "no verified domain: only the account owner's address can receive"]; });

// Cal.com
const ch = { Authorization: `Bearer ${env("CAL_API_KEY")}` };
await t("Cal.com key works", async () => { const { r, body } = await j("https://api.cal.com/v2/me", { headers: { ...ch, "cal-api-version": "2024-08-13" } }); return [r.ok ? "OK" : "FAIL", `account ${body?.data?.username}`]; });
await t("Cal.com returns real slots", async () => {
  const s = new Date(Date.now() + 3600e3).toISOString(), e = new Date(Date.now() + 5 * 86400e3).toISOString();
  const { r, body } = await j(`https://api.cal.com/v2/slots?eventTypeId=${env("CAL_EVENT_TYPE_ID")}&start=${s}&end=${e}&timeZone=Asia/Kolkata`, { headers: { ...ch, "cal-api-version": "2024-09-04" } });
  const n = Object.values(body?.data ?? {}).flat().length; return [r.ok && n > 0 ? "OK" : "FAIL", `${n} open slots in 5 days`];
});
await t("Cal.com: upcoming bookings", async () => { const { body } = await j("https://api.cal.com/v2/bookings?status=upcoming,unconfirmed&take=50", { headers: { ...ch, "cal-api-version": "2026-02-25" } }); const n = (body?.data ?? []).length; return [n ? "WARN" : "OK", `${n} upcoming (any "ZZ TEST" ones are mine; the others are real bookings)`]; });

// Webhook readiness
await t("Webhook secret configured", async () => [optionalEnv("VAANI_WEBHOOK_SECRET").length >= 24 ? "OK" : "FAIL", "long random secret present"]);
await t("Backend deployed and reachable (Vercel)", async () => { const { r } = await j("https://aangan-receptionist-one.vercel.app/health", {}); return [r.ok ? "OK" : "FAIL", `HTTP ${r.status}`]; });
await t("Vaani API key saved", async () => [optionalEnv("VAANI_API_KEY") ? "OK" : "WARN", optionalEnv("VAANI_API_KEY") ? "set" : "not set (needed only to fetch transcripts/costs by API)"]);

const c = (s: string) => rows.filter((r) => r[1] === s).length;
console.log(`\n${c("OK")} OK, ${c("WARN")} warnings, ${c("FAIL")} failures`);
