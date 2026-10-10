// One-time (and safe to repeat) HubSpot setup: property groups, custom properties, the Aangan pipeline, the metrics company.
// Usage: npm run hubspot:setup
import { appendFileSync, readFileSync } from "node:fs";
import { hs, HubSpotError } from "./client.js";
import { COMPANY_PROPS, CONTACT_PROPS, DEAL_AI_PROPS, DEAL_ANALYSIS_PROPS, DEAL_INTERNAL_PROPS, GROUPS, METRICS_COMPANY_NAME, PIPELINE, type Def } from "./schema.js";

const log = (s: string) => console.log(s);

async function ensureGroup(obj: string, g: { name: string; label: string }) {
  try {
    await hs("POST", `/crm/v3/properties/${obj}/groups`, { name: g.name, label: g.label, displayOrder: -1 });
    log(`  created group ${obj}/${g.name}`);
  } catch (e) {
    if (e instanceof HubSpotError && e.status === 409) return;
    throw e;
  }
}

function payload(d: Def, group: string) {
  const base: any = { name: d.name, label: d.label, groupName: group, description: d.description };
  if (d.unique) base.hasUniqueValue = true;
  switch (d.kind) {
    case "text": return { ...base, type: "string", fieldType: "text" };
    case "textarea": return { ...base, type: "string", fieldType: "textarea" };
    case "number": return { ...base, type: "number", fieldType: "number" };
    case "date": return { ...base, type: "date", fieldType: "date" };
    case "datetime": return { ...base, type: "datetime", fieldType: "date" };
    case "enum": return { ...base, type: "enumeration", fieldType: "select", options: d.options!.map(([value, label], i) => ({ label, value, displayOrder: i })) };
  }
}

async function ensureProps(obj: string, group: string, defs: Def[]) {
  let made = 0, existed = 0;
  for (const d of defs) {
    try {
      await hs("POST", `/crm/v3/properties/${obj}`, payload(d, group));
      made++;
    } catch (e) {
      if (e instanceof HubSpotError && e.status === 409) { existed++; continue; }
      throw e;
    }
  }
  log(`  ${obj}: ${made} created, ${existed} already there`);
}

async function ensurePipeline() {
  const all = await hs<{ results: any[] }>("GET", "/crm/v3/pipelines/deals");
  let p = all.results.find((x) => x.label === PIPELINE.label);
  if (!p) {
    p = await hs("POST", "/crm/v3/pipelines/deals", {
      label: PIPELINE.label, displayOrder: 1,
      stages: PIPELINE.stages.map((s, i) => ({ label: s.label, displayOrder: i, metadata: { probability: s.probability, ...(s.closed ? { isClosed: "true" } : {}) } })),
    });
    log(`  created pipeline "${PIPELINE.label}"`);
  } else log(`  pipeline "${PIPELINE.label}" already exists`);
  const stages: Record<string, string> = {};
  for (const s of PIPELINE.stages) stages[s.key] = p.stages.find((x: any) => x.label === s.label)?.id;
  return { pipelineId: p.id as string, stages };
}

async function ensureMetricsCompany() {
  const r = await hs<{ results: any[] }>("POST", "/crm/v3/objects/companies/search", {
    filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: METRICS_COMPANY_NAME }] }], limit: 1,
  });
  if (r.results[0]) { log(`  metrics company already exists`); return r.results[0].id as string; }
  const c = await hs("POST", "/crm/v3/objects/companies", { properties: { name: METRICS_COMPANY_NAME } });
  log(`  created metrics company`);
  return c.id as string;
}

log("Property groups");
for (const o of ["contacts", "deals", "companies"]) await ensureGroup(o, o === "companies" ? GROUPS.metrics : GROUPS.ai);
await ensureGroup("deals", GROUPS.internal);
log("Properties");
await ensureProps("contacts", GROUPS.ai.name, CONTACT_PROPS);
await ensureProps("deals", GROUPS.ai.name, DEAL_AI_PROPS);
await ensureProps("deals", GROUPS.ai.name, DEAL_ANALYSIS_PROPS);
await ensureProps("deals", GROUPS.internal.name, DEAL_INTERNAL_PROPS);
await ensureProps("companies", GROUPS.metrics.name, COMPANY_PROPS);
log("Pipeline");
const { pipelineId, stages } = await ensurePipeline();
log("Metrics record");
const companyId = await ensureMetricsCompany();

// Remember the ids locally (not secrets) so the sync does not have to look them up.
const envText = readFileSync(".env.local", "utf8");
const set = (k: string, v: string) => { if (!new RegExp(`^${k}=`, "m").test(envText)) appendFileSync(".env.local", `\n${k}=${v}`); };
set("HUBSPOT_PIPELINE_ID", pipelineId);
set("HUBSPOT_STAGE_IDS", JSON.stringify(stages));
set("HUBSPOT_METRICS_COMPANY_ID", companyId);
log(`\nDone. pipeline=${pipelineId} metricsCompany=${companyId}`);
