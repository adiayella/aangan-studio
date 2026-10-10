import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deskRouter, hashKey } from "../src/desk/api.js";

// A fake database that knows two private links and two leads, and applies the designer filter like the real SQL.
const TEAM_KEY = "t".repeat(64), ARYAN_KEY = "a".repeat(64), MEERA_KEY = "m".repeat(64);
const ARYAN = "11111111-1111-4111-8111-111111111111", MEERA = "22222222-2222-4222-8222-222222222222";
const LEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", LEAD_M = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const keys = new Map([[hashKey(TEAM_KEY), { id: "k1", designer_id: null, label: "Team view" }], [hashKey(ARYAN_KEY), { id: "k2", designer_id: ARYAN, label: "Aryan" }], [hashKey(MEERA_KEY), { id: "k3", designer_id: MEERA, label: "Meera" }]]);
const leads = [
  { id: LEAD_A, designer: ARYAN, verdict: "QUALIFIED", stage: "new" }, { id: LEAD_M, designer: MEERA, verdict: "QUALIFIED", stage: "new" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", designer: null, verdict: "ESCALATION", stage: "new" }, { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", designer: ARYAN, verdict: "UNQUALIFIED", stage: "new" },
];
const seen: { sql: string; params: unknown[] }[] = [];
const fakeDb = {
  query: async (sql: string, params: unknown[] = []) => {
    seen.push({ sql, params });
    if (/from access_keys/.test(sql) && /select/.test(sql)) { const k = keys.get(String(params[0])); return { rows: k ? [k] : [] }; }
    if (/update access_keys/.test(sql)) return { rows: [] };
    if (/from enquiries e/.test(sql)) {
      const d = params[0] as string | null;
      const rows = leads.filter((l) => d === null || (l.designer === d && ["QUALIFIED", "NEEDS_REVIEW"].includes(l.verdict)))
        .map((l) => ({ id: l.id, verdict: l.verdict, stage: l.stage, customer_name: null, criteria: [{ key: "timeline", status: "pass", reason: "ok" }], hubspot_deal_id: null }));
      return { rows };
    }
    if (/update enquiries/.test(sql)) { const [stage, id, d] = params as [string, string, string | null]; const l = leads.find((x) => x.id === id && (d === null || x.designer === d)); if (l) l.stage = stage; return { rows: l ? [{ id }] : [] }; }
    return { rows: [] };
  },
} as any;

let base = "", server: any;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api/desk", deskRouter(() => fakeDb));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/desk`;
});
afterAll(() => server.close());

const get = (key?: string) => fetch(`${base}/leads`, { headers: key ? { "x-desk-key": key } : {} });
const setStage = (id: string, stage: string, key?: string) => fetch(`${base}/leads/${id}/stage`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-desk-key": key } : {}) }, body: JSON.stringify({ stage }) });

describe("Designer Desk private links", () => {
  it("rejects a missing, short or unknown key", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("short")).status).toBe(401);
    expect((await get("x".repeat(64))).status).toBe(401);
  });
  it("only the HASH of the key reaches the database, never the key itself", async () => {
    await get(ARYAN_KEY);
    const lookup = seen.find((s) => /from access_keys/.test(s.sql) && /select/.test(s.sql) && s.params[0] === hashKey(ARYAN_KEY));
    expect(lookup).toBeTruthy();
    expect(JSON.stringify(seen.map((s) => s.params))).not.toContain(ARYAN_KEY);
  });
  it("a designer's link shows only that designer's selected leads", async () => {
    const j: any = await (await get(ARYAN_KEY)).json();
    expect(j.who).toEqual({ label: "Aryan", team: false });
    expect(j.leads.map((l: any) => l.id)).toEqual([LEAD_A]); // not Meera's, not the unassigned complaint, not the declined one
  });
  it("the team link shows every enquiry, including declined and urgent ones", async () => {
    const j: any = await (await get(TEAM_KEY)).json();
    expect(j.who.team).toBe(true);
    expect(j.leads).toHaveLength(4);
  });
  it("adds readable labels to the criteria and a default name for unknown callers", async () => {
    const j: any = await (await get(TEAM_KEY)).json();
    expect(j.leads[0].criteria[0].label).toBe("Timeline");
    expect(j.leads[0].customer_name).toBe("Unknown caller");
  });
  it("never returns estimate fields", async () => {
    const text = JSON.stringify(await (await get(TEAM_KEY)).json());
    expect(text).not.toMatch(/est_|estimate|pipeline_low|pipeline_high/i);
    expect(seen.filter((s) => /from enquiries e/.test(s.sql)).every((s) => !/estimates/i.test(s.sql))).toBe(true);
  });
  it("a designer can change their own lead's stage but not another designer's", async () => {
    expect((await setStage(LEAD_A, "contacted", ARYAN_KEY)).status).toBe(200);
    expect(leads.find((l) => l.id === LEAD_A)!.stage).toBe("contacted");
    expect((await setStage(LEAD_M, "won", ARYAN_KEY)).status).toBe(404);
    expect(leads.find((l) => l.id === LEAD_M)!.stage).toBe("new");
  });
  it("the team link can change any lead", async () => {
    expect((await setStage(LEAD_M, "contacted", TEAM_KEY)).status).toBe(200);
  });
  it("rejects bad stages, bad ids and missing keys", async () => {
    expect((await setStage(LEAD_A, "hacked", TEAM_KEY)).status).toBe(400);
    expect((await setStage("not-a-uuid", "won", TEAM_KEY)).status).toBe(400);
    expect((await setStage(LEAD_A, "won")).status).toBe(401);
  });
  it("responses are not cached", async () => {
    expect((await get(TEAM_KEY)).headers.get("cache-control")).toBe("no-store");
  });
  it("public view lists every lead but never exposes contact details or links", async () => {
    const r = await fetch(`${base}/public`);
    expect(r.status).toBe(200);
    const d: any = await r.json();
    expect(d.leads.length).toBe(leads.length);
    for (const l of d.leads) for (const k of ["phone", "email", "meet_link", "notes", "hubspot_deal_id", "hubspot_url"]) expect(l).not.toHaveProperty(k);
  });
});
