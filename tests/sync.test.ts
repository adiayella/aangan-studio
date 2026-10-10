import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lead = async (over: object = {}) => {
  const { qualify } = await import("../src/qualification/rules.js");
  const { EnquiryFactsSchema } = await import("../src/qualification/types.js");
  const { estimateValue } = await import("../src/value/estimate.js");
  const f = EnquiryFactsSchema.parse({ intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1000, locality: "Baner", city: "Pune", deadline_weeks: 20, decision_maker: "self" });
  return { enquiry_id: "e1", customer_id: "c1", call_id: "call1", call_time: "2026-09-02T04:53:00Z", call_duration_sec: 60, name: "A B", phone: "9876543210", email: null, facts: f, property_type: "2BHK", requirements: "x", deadline_text: "x", qualification: qualify(f), summary: "s", estimate: estimateValue(f), designer: "D", stage: "new" as const, consult: { status: "none" as const, starts_at: null, mode: null }, ...over };
};

describe("HubSpot client resilience", () => {
  beforeEach(() => { process.env.HUBSPOT_ACCESS_TOKEN = "pat-na2-test-0000000000000000000000000"; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it("retries a temporary 429 then succeeds", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const { hs } = await import("../src/hubspot/client.js");
    const p = hs("GET", "/x");
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("retries network errors and then gives up with a redacted error", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", f);
    const { hs } = await import("../src/hubspot/client.js");
    const p = hs("GET", "/x").catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(f).toHaveBeenCalledTimes(4);
    expect(String(err.message)).toContain("HubSpot 0");
  });
  it("does not retry a 400", async () => {
    const f = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", f);
    const { hs } = await import("../src/hubspot/client.js");
    await expect(hs("GET", "/x")).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("error messages never contain the key or a phone number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bearer pat-na2-test-0000000000000000000000000 +91 98765 43210", { status: 403 })));
    const { hs } = await import("../src/hubspot/client.js");
    const err = await hs("GET", "/x").catch((e) => e);
    expect(err.message).not.toMatch(/pat-na2|98765/);
  });
});

describe("sync modes and ambiguity", () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); vi.doUnmock("../src/hubspot/client.js"); });

  it("mock mode sends nothing and is labelled", async () => {
    vi.stubEnv("HUBSPOT_SYNC_MODE", "mock");
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { syncEnquiry } = await import("../src/hubspot/sync.js");
    const r = await syncEnquiry(await lead());
    expect(r.mock).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain("[MOCK HubSpot sync]");
    log.mockRestore(); vi.unstubAllGlobals();
  });
  it("defaults to mock when no HubSpot key is configured", async () => {
    vi.stubEnv("HUBSPOT_SYNC_MODE", ""); vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "");
    const { syncMode } = await import("../src/hubspot/sync.js");
    expect(syncMode()).toBe("mock");
  });
  it("two contacts sharing a phone number: flagged, call attached to neither", async () => {
    vi.stubEnv("HUBSPOT_SYNC_MODE", "live"); vi.stubEnv("HUBSPOT_PIPELINE_ID", "p"); vi.stubEnv("HUBSPOT_STAGE_IDS", JSON.stringify({ new: "s1", lost: "s6" }));
    const calls: string[] = [];
    vi.doMock("../src/hubspot/client.js", () => ({
      HubSpotError: class extends Error { status = 0; body = ""; },
      hs: vi.fn(async (method: string, path: string, body?: any) => {
        calls.push(`${method} ${path}`);
        if (path.includes("/contacts/search")) {
          const prop = body.filterGroups[0].filters[0].propertyName;
          return { results: prop === "phone" ? [{ id: "111" }, { id: "222" }] : [] };
        }
        if (path.includes("/deals/search")) return { results: [] };
        if (method === "POST" && path === "/crm/v3/objects/deals") { expect(body.properties.aangan_sync_status).toBe("NEEDS_MATCH_REVIEW"); return { id: "D1" }; }
        if (method === "POST" && path === "/crm/v3/objects/notes") { expect(body.associations).toHaveLength(1); return { id: "N1" }; }
        return {};
      }),
    }));
    const { syncEnquiry } = await import("../src/hubspot/sync.js");
    const r = await syncEnquiry(await lead());
    expect(r).toMatchObject({ status: "NEEDS_MATCH_REVIEW", contactId: null, dealId: "D1" });
    expect(r.review_reason).toMatch(/2 records match/);
    expect(calls.some((c) => c.includes("/associations/default/contacts"))).toBe(false); // never attached to a guess
    expect(calls.some((c) => c.startsWith("PATCH /crm/v3/objects/contacts"))).toBe(false); // never modified either contact
  });
});

describe("tracking in mock mode", () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });
  it("never records a mock sync as 'synced' and stores no fake ids", async () => {
    vi.stubEnv("HUBSPOT_SYNC_MODE", "mock");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const queries: { sql: string; params: unknown[] }[] = [];
    const db: any = { query: async (sql: string, params: unknown[] = []) => { queries.push({ sql, params }); return { rows: [] }; } };
    const { runTrackedSync } = await import("../src/hubspot/track.js");
    const r = await runTrackedSync(db, await lead());
    expect(r.ok).toBe(true);
    const write = queries.find((q) => /insert into hubspot_sync/.test(q.sql))!;
    expect(write.sql).toContain("'pending'");
    expect(write.sql).not.toContain("'synced'");
    expect(JSON.stringify(write.params)).not.toMatch(/mock-deal|mock-contact/);
  });
});
