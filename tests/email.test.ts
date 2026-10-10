import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDesignerEmail, type EmailLead } from "../src/email/templates.js";
import { qualify } from "../src/qualification/rules.js";
import { EnquiryFactsSchema } from "../src/qualification/types.js";

const mk = (over: Partial<EmailLead> = {}, facts: object = {}): EmailLead => {
  const f = EnquiryFactsSchema.parse({ intent: "design_and_execution", segment: "residential", full_home: true, area_sqft: 1400, locality: "Baner", city: "Pune", deadline_weeks: 24, decision_maker: "self", ...facts });
  const q = qualify(f);
  return {
    name: "Priya Sathe", phone: "+919876543210", email: "priya@gmail.com", locality: "Baner", city: "Pune", segment: "residential", property_type: "3BHK",
    area_sqft: 1400, designed_area_sqft: 1400, requirements: "Full redesign of kitchen, living room and bedrooms", deadline_text: "By March",
    verdict: q.verdict, criteria: q.criteria, explanation: q.explanation, notes: q.notes, summary: "Priya wants a full redesign of her 3BHK.", designer: "Aryan",
    call_time: "2026-10-10T05:00:00Z", consult: { status: "none", starts_at: null, mode: null, location: null, link: null }, hubspot_url: "https://app-na2.hubspot.com/x", analysis_url: null, ...over,
  };
};

describe("designer email content", () => {
  it("uses the subject format from the brief", () => {
    expect(renderDesignerEmail(mk()).subject).toBe("New Qualified Enquiry — 3BHK Interior Design — Baner");
  });
  it("shows customer, project, per-criterion PASS/UNCERTAIN, summary and link", () => {
    const t = renderDesignerEmail(mk()).text;
    for (const s of ["Priya Sathe", "+919876543210", "priya@gmail.com", "1400 sq ft", "Location: PASS", "Budget: UNCERTAIN", "Still unclear", "full redesign of her 3BHK", "https://app-na2.hubspot.com/x"]) expect(t).toContain(s);
  });
  it("never contains a price, rate or estimate", () => {
    const m = renderDesignerEmail(mk());
    expect(m.text + m.html).not.toMatch(/₹|\blakh\b|per sq|\/sq|estimate|INDICATIVE|quotation|\b2520000\b/i);
  });
  it("a requested consultation is NOT described as confirmed and says no invitation was sent", () => {
    const t = renderDesignerEmail(mk({ consult: { status: "pending", starts_at: "2026-10-14T11:30:00Z", mode: "site_visit", location: "Baner", link: null } })).text;
    expect(t).toMatch(/REQUESTED by the caller, NOT yet confirmed/);
    expect(t).toContain("No calendar invitation has been sent");
    expect(t).not.toMatch(/CONFIRMED in Google Calendar/);
  });
  it("a booked appointment says the calendar is booked, shows time and type, and that the customer was not told", () => {
    const t = renderDesignerEmail(mk({ consult: { status: "confirmed", starts_at: "2026-10-14T11:30:00Z", mode: "site_visit", location: "Baner, Pune", link: null, host: "nikhil@x.com" } })).text;
    expect(t).toMatch(/BOOKED on the calendar of nikhil@x.com for .*14 Oct, 2026/);
    expect(t).toContain("Location: Baner, Pune");
    expect(t).toContain("has NOT been told the slot is confirmed");
  });
  it("an online booking shows the meeting link", () => {
    const t = renderDesignerEmail(mk({ consult: { status: "confirmed", starts_at: "2026-10-14T11:30:00Z", mode: "online", location: null, link: "https://app.cal.com/video/abc" } })).text;
    expect(t).toContain("Link: https://app.cal.com/video/abc");
  });
  it("the designer email does not depend on the customer's email being right", () => {
    for (const email of [null, "mishea rd@@gmail", "ayla.adwight@gmail.com"]) {
      const m = renderDesignerEmail(mk({ email, consult: { status: "confirmed", starts_at: "2026-10-14T11:30:00Z", mode: "online", location: null, link: null } }));
      expect(m.subject).toMatch(/^New Qualified Enquiry/);
      expect(m.text).toContain("BOOKED on the calendar");
    }
  });
  it("flags a missing email address", () => {
    expect(renderDesignerEmail(mk({ email: null })).text).toMatch(/Email: Not captured/);
  });
  it("escapes HTML in caller-supplied text", () => {
    const h = renderDesignerEmail(mk({ requirements: "<script>alert(1)</script>", name: "A&B <b>" })).html;
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
  it("ignores non-http links", () => {
    expect(renderDesignerEmail(mk({ hubspot_url: "javascript:alert(1)" })).html).not.toContain("javascript:");
  });
  it("needs-review leads are labelled and list what is unclear", () => {
    const m = renderDesignerEmail(mk({}, { deadline_weeks: null }));
    expect(m.subject).toMatch(/^Enquiry Needing Review/);
    expect(m.text).toContain("Timeline: UNCERTAIN");
  });
  it("urgent complaint: high priority, URGENT subject, no qualification section", () => {
    const l = mk({ verdict: "ESCALATION", criteria: [], property_type: "2BHK" }, { existing_client_complaint: true });
    const m = renderDesignerEmail(l);
    expect(m).toMatchObject({ priority: "high" });
    expect(m.subject).toMatch(/^URGENT — Existing client complaint — Priya Sathe/);
    expect(m.text).not.toContain("QUALIFICATION");
  });
});

describe("sending", () => {
  const OLD = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...OLD }; vi.unstubAllGlobals(); });

  it("mock mode sends nothing", async () => {
    process.env.EMAIL_MODE = "mock"; const f = vi.fn(); vi.stubGlobal("fetch", f);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendEmail } = await import("../src/email/resend.js");
    const r = await sendEmail("d@x.com", renderDesignerEmail(mk()), "k1");
    expect(r).toMatchObject({ ok: true, mock: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("live: sends once with an idempotency key and the redirect/test subject", async () => {
    process.env.EMAIL_MODE = "live"; process.env.RESEND_API_KEY = "re_test_key"; process.env.EMAIL_REDIRECT_TO = "owner@x.com";
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "em_1" }), { status: 200 })); vi.stubGlobal("fetch", f);
    const { sendEmail } = await import("../src/email/resend.js");
    const r = await sendEmail("designer@x.com", renderDesignerEmail(mk()), "designer_handoff-e1");
    expect(r).toMatchObject({ ok: true, id: "em_1", to: "owner@x.com", redirected: true });
    const [, init] = f.mock.calls[0]; const body = JSON.parse(init.body);
    expect(init.headers["Idempotency-Key"]).toBe("designer_handoff-e1");
    expect(body.to).toEqual(["owner@x.com"]);
    expect(body.subject).toMatch(/^\[TEST — for designer@x\.com\] New Qualified Enquiry/);
  });
  it("live: a rejected send is reported, with no key in the message", async () => {
    process.env.EMAIL_MODE = "live"; process.env.RESEND_API_KEY = "re_test_key"; delete process.env.EMAIL_REDIRECT_TO;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Domain not verified, Bearer re_test_key" }), { status: 403 })));
    const { sendEmail } = await import("../src/email/resend.js");
    const r = await sendEmail("d@x.com", renderDesignerEmail(mk()), "k");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("403");
  });
  it("live: retries a temporary 500 then succeeds", async () => {
    process.env.EMAIL_MODE = "live"; process.env.RESEND_API_KEY = "re_test_key";
    const f = vi.fn().mockResolvedValueOnce(new Response("oops", { status: 500 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: "em_2" }), { status: 200 })); vi.stubGlobal("fetch", f);
    const { sendEmail } = await import("../src/email/resend.js");
    const r = await sendEmail("d@x.com", renderDesignerEmail(mk()), "k");
    expect(r).toMatchObject({ ok: true, id: "em_2" });
    expect(f).toHaveBeenCalledTimes(2);
  }, 10000);
});

describe("recipient choice (no founder email: the founder uses the dashboard)", () => {
  it("qualified and needs-review go to the assigned designer only", async () => {
    const { chooseRecipient } = await import("../src/email/notify.js");
    expect(chooseRecipient("QUALIFIED", "aryan@x.com")).toMatchObject({ kind: "designer_handoff", to: "aryan@x.com" });
    expect(chooseRecipient("NEEDS_REVIEW", "aryan@x.com")).toMatchObject({ to: "aryan@x.com" });
  });
  it("an urgent complaint is never emailed, even to the designer it is about", async () => {
    const { chooseRecipient } = await import("../src/email/notify.js");
    expect(chooseRecipient("ESCALATION", "aryan@x.com")).toMatchObject({ kind: "urgent_escalation", to: null });
  });
  it("a lead with no designer is not emailed to anyone, and says so", async () => {
    const { chooseRecipient } = await import("../src/email/notify.js");
    const r = chooseRecipient("QUALIFIED", null);
    expect(r).toMatchObject({ to: null });
    expect(r?.note).toMatch(/dashboard/);
  });
  it("unqualified leads send nothing", async () => {
    const { chooseRecipient } = await import("../src/email/notify.js");
    expect(chooseRecipient("UNQUALIFIED", "aryan@x.com")).toBeNull();
  });
  it("a FOUNDER_EMAIL setting, if present, is ignored", async () => {
    process.env.FOUNDER_EMAIL = "nikhil@x.com";
    const { chooseRecipient } = await import("../src/email/notify.js");
    expect(chooseRecipient("ESCALATION", null)?.to).toBeNull();
    expect(chooseRecipient("QUALIFIED", null)?.to).toBeNull();
    delete process.env.FOUNDER_EMAIL;
  });
});
