import type { CriterionResult, Verdict } from "../qualification/types.js";

/**
 * Designer and escalation emails. CONTENT RULE: no price, rate, estimate or budget figure ever appears here.
 * Pricing is the designer's job; internal estimates live only in Neon and the founder's HubSpot.
 */
export interface EmailLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  locality: string | null;
  city: string | null;
  segment: string;
  property_type: string | null;
  area_sqft: number | null;
  designed_area_sqft: number | null;
  requirements: string | null;
  deadline_text: string | null;
  verdict: Verdict;
  criteria: CriterionResult[];
  explanation: string;
  notes: string[];
  summary: string;
  designer: string | null;
  call_time: string;
  consult: { status: "none" | "pending" | "confirmed" | "completed" | "cancelled"; starts_at: string | null; mode: "online" | "site_visit" | null; location: string | null; link: string | null; host?: string | null };
  hubspot_url: string | null;
  analysis_url: string | null;
}

export interface Rendered { subject: string; html: string; text: string; priority: "normal" | "high" }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]!);
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);
const LABEL: Record<CriterionResult["status"], string> = { pass: "PASS", fail: "FAIL", unclear: "UNCERTAIN" };
const CRIT: Record<string, string> = { real_project: "Real project", service_area: "Location", timeline: "Timeline", budget: "Budget", decision_maker: "Decision-maker" };
const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) + " IST";

function consultLines(l: EmailLead): string[] {
  const c = l.consult;
  if (c.status === "confirmed" || c.status === "completed")
    return [
      `Status: BOOKED on the calendar${c.host ? ` of ${c.host}` : ""}${c.starts_at ? ` for ${ist(c.starts_at)}` : ""}`,
      `Type: ${c.mode === "online" ? "Online meeting" : "Site visit"}`,
      c.mode === "online" ? `Link: ${c.link ?? "in the calendar entry"}` : `Location: ${c.location ?? "see the calendar entry"}`,
      "Customer: was only asked for their free time and has NOT been told the slot is confirmed. Please confirm it with them.",
    ];
  if (c.status === "pending")
    return [`Status: REQUESTED by the caller, NOT yet confirmed. No calendar invitation has been sent.`, c.starts_at ? `Caller's preferred time: ${ist(c.starts_at)}` : "Caller's preferred time: not specified", `Preferred type: ${c.mode === "online" ? "Online meeting" : c.mode === "site_visit" ? "Site visit" : "not specified"}`, ...(c.location ? [`Location: ${c.location}`] : [])];
  return ["Status: no consultation requested yet. Please call the customer to arrange one."];
}

export function renderDesignerEmail(l: EmailLead): Rendered {
  const place = [l.locality, l.city].filter(Boolean).join(", ") || "location not given";
  const what = l.property_type ? `${l.property_type} Interior Design` : l.segment === "commercial" ? "Commercial Interior Design" : "Interior Design";
  const urgent = l.verdict === "ESCALATION";
  const subject = urgent
    ? `URGENT — Existing client complaint — ${l.name ?? "caller"} — ${l.locality ?? l.city ?? "location unknown"}`
    : `${l.verdict === "NEEDS_REVIEW" ? "Enquiry Needing Review" : "New Qualified Enquiry"} — ${what} — ${l.locality ?? l.city ?? "location unknown"}`;

  const customer = [["Name", l.name ?? "Not captured"], ["Phone", l.phone ?? "Not captured"], ["Email", l.email ?? "Not captured (no calendar invitation possible until we have it)"]];
  const project = urgent
    ? [["Location", place], ["Details", l.requirements ?? "see summary"]]
    : [["Location", place], ["Project type", `${l.segment === "commercial" ? "Commercial" : "Residential"}${l.property_type ? ` — ${l.property_type}` : ""}`],
       ["Carpet area", l.area_sqft ? `${l.area_sqft} sq ft${l.designed_area_sqft && l.designed_area_sqft !== l.area_sqft ? ` (designing ${l.designed_area_sqft} sq ft)` : ""}` : "Not given"],
       ["Requirements", l.requirements ?? "Not given"], ["Timeline", l.deadline_text ?? "Not given"]];
  const verdictText = { QUALIFIED: "QUALIFIED", NEEDS_REVIEW: "NEEDS REVIEW", ESCALATION: "URGENT ESCALATION", UNQUALIFIED: "UNQUALIFIED" }[l.verdict];
  const missing = l.criteria.filter((c) => c.status === "unclear").map((c) => `${CRIT[c.key]}: ${c.reason}`);
  const concerns = [...l.notes, ...(l.verdict === "NEEDS_REVIEW" ? [l.explanation] : [])];
  const links = [["HubSpot record", safeUrl(l.hubspot_url)], ["Call analysis", safeUrl(l.analysis_url)]].filter(([, u]) => u) as [string, string][];
  const when = ist(l.call_time);

  const text = [
    urgent ? "URGENT: EXISTING CLIENT NEEDS A CALL BACK" : `${verdictText} lead for ${l.designer ?? "the studio"}`, `Call received ${when}`, "",
    "CUSTOMER", ...customer.map(([k, v]) => `  ${k}: ${v}`), "",
    "PROJECT", ...project.map(([k, v]) => `  ${k}: ${v}`), "",
    ...(urgent ? [] : ["QUALIFICATION", `  Status: ${verdictText}`, ...l.criteria.map((c) => `  ${CRIT[c.key]}: ${LABEL[c.status]} — ${c.reason}`),
      ...(missing.length ? ["  Still unclear:", ...missing.map((m) => `    - ${m}`)] : []), ...(concerns.length ? ["  Worth knowing:", ...concerns.map((m) => `    - ${m}`)] : []), "",
      "CONSULTATION", ...consultLines(l).map((x) => `  ${x}`), ""]),
    "CALL SUMMARY", `  ${l.summary}`, "", ...(links.length ? ["LINKS", ...links.map(([k, u]) => `  ${k}: ${u}`), ""] : []),
    "Pricing is for you to discuss with the customer at the consultation. Please do not forward this email outside the studio.",
  ].join("\n");

  const row = (k: string, v: string) => `<tr><td style="padding:3px 12px 3px 0;color:#6b5f55;vertical-align:top">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`;
  const h = (t: string) => `<h3 style="margin:18px 0 6px;font:600 12px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6b5f55">${esc(t)}</h3>`;
  const colour = (s: CriterionResult["status"]) => (s === "pass" ? "#2f6b4a" : s === "fail" ? "#9b2c2c" : "#8a5a00");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f1ea;font:15px/1.5 Arial,sans-serif;color:#2b2420"><div style="max-width:620px;margin:0 auto;padding:20px">
<div style="background:${urgent ? "#9b2c2c" : "#a4532b"};color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><div style="font-size:12px;letter-spacing:.08em">AANGAN STUDIO</div><div style="font-size:18px;font-weight:600">${esc(urgent ? "Urgent: existing client needs a call back" : `${verdictText.charAt(0) + verdictText.slice(1).toLowerCase()} lead`)}</div></div>
<div style="background:#fffdf9;padding:6px 18px 18px;border:1px solid #e6ddd1;border-top:0;border-radius:0 0 10px 10px">
<p style="color:#6b5f55;margin:12px 0 0">Call received ${esc(when)}${l.designer ? ` · assigned to ${esc(l.designer)}` : ""}</p>
${h("Customer")}<table style="border-collapse:collapse">${customer.map(([k, v]) => row(k, v)).join("")}</table>
${h("Project")}<table style="border-collapse:collapse">${project.map(([k, v]) => row(k, v)).join("")}</table>
${urgent ? "" : `${h("Qualification")}<p style="margin:0 0 6px"><b>${esc(verdictText)}</b></p><table style="border-collapse:collapse">${l.criteria.map((c) => `<tr><td style="padding:3px 12px 3px 0;color:#6b5f55;vertical-align:top">${esc(CRIT[c.key])}</td><td style="padding:3px 0"><b style="color:${colour(c.status)}">${LABEL[c.status]}</b> — ${esc(c.reason)}</td></tr>`).join("")}</table>
${missing.length ? `<p style="margin:8px 0 2px"><b>Still unclear</b></p><ul style="margin:0;padding-left:20px">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
${concerns.length ? `<p style="margin:8px 0 2px"><b>Worth knowing</b></p><ul style="margin:0;padding-left:20px">${concerns.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
${h("Consultation")}<table style="border-collapse:collapse">${consultLines(l).map((x) => { const i = x.indexOf(": "); return row(x.slice(0, i), x.slice(i + 2)); }).join("")}</table>`}
${h("Call summary")}<p style="margin:0;background:#f1e7da;padding:10px 12px;border-radius:8px">${esc(l.summary)}</p>
${links.length ? `${h("Links")}<p style="margin:0">${links.map(([k, u]) => `<a href="${esc(u)}" style="color:#a4532b">${esc(k)}</a>`).join(" &nbsp;·&nbsp; ")}</p>` : ""}
<p style="margin:18px 0 0;font-size:12px;color:#6b5f55">Pricing is for you to discuss with the customer at the consultation. Please do not forward this email outside the studio.</p></div></div></body></html>`;

  return { subject, html, text, priority: urgent ? "high" : "normal" };
}
