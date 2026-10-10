import { env, optionalEnv } from "../config.js";
import { redact } from "../util/redact.js";
import { hs, HubSpotError } from "./client.js";
import { contactProperties, dealProperties, noteBody, noteMarker, normalizePhone, syncMeta, updateRules, validEmail, type SyncLead } from "./map.js";

export interface SyncResult {
  status: "SYNCED" | "NEEDS_MATCH_REVIEW";
  contactId: string | null;
  dealId: string;
  noteId: string | null;
  contactCreated: boolean;
  dealCreated: boolean;
  noteCreated: boolean;
  mock?: boolean;
  /** Why a human needs to look (redacted). Present when status is NEEDS_MATCH_REVIEW. */
  review_reason?: string;
}

/** Thrown internally when more than one HubSpot record matches an identifier. */
class AmbiguousMatch extends Error {
  constructor(public what: string, public ids: string[]) { super(`${what}: ${ids.length} records match (${ids.join(", ")})`); }
}

/** "mock" never touches HubSpot. It is also the automatic mode while no HubSpot key is configured. */
export const syncMode = (): "live" | "mock" => {
  const m = optionalEnv("HUBSPOT_SYNC_MODE");
  if (m === "live" || m === "mock") return m;
  return optionalEnv("HUBSPOT_ACCESS_TOKEN") ? "live" : "mock";
};

async function searchIds(obj: string, filters: unknown[]): Promise<string[]> {
  const r = await hs<{ results: { id: string }[] }>("POST", `/crm/v3/objects/${obj}/search`, { filterGroups: [{ filters }], limit: 3 });
  return r.results.map((x) => x.id);
}

/** A mis-heard email must never block a lead: if HubSpot rejects the email, retry without it. */
async function writeContact(method: string, path: string, properties: Record<string, string>): Promise<{ id: string }> {
  try {
    return await hs(method, path, { properties });
  } catch (e) {
    if (e instanceof HubSpotError && e.status === 400 && /INVALID_EMAIL/.test(e.body) && properties.email) {
      const { email: _dropped, ...rest } = properties;
      return hs(method, path, { properties: rest });
    }
    throw e;
  }
}

const omitNames = ({ firstname: _f, lastname: _l, ...rest }: Record<string, string>) => rest;
const holderId = (e: unknown) => (e instanceof HubSpotError ? /(\d+) already has that value/.exec(e.body)?.[1] ?? null : null);

/**
 * Finds the existing contact by customer id, then phone, then email. Never by name.
 * More than one match on any identifier throws AmbiguousMatch: the call is then not attached to any contact.
 */
async function upsertContact(l: SyncLead): Promise<{ id: string; created: boolean }> {
  const props = contactProperties(l) as Record<string, string>;
  if (l.hubspot_contact_id) {
    await writeContact("PATCH", `/crm/v3/objects/contacts/${l.hubspot_contact_id}`, omitNames(props));
    return { id: l.hubspot_contact_id, created: false };
  }
  const phone = normalizePhone(l.phone);
  const email = validEmail(l.email);
  const tries: [string, unknown[]][] = [["customer id", [{ propertyName: "aangan_neon_customer_id", operator: "EQ", value: l.customer_id }]]];
  if (phone) tries.push(["phone number", [{ propertyName: "phone", operator: "EQ", value: phone }]]);
  if (email) tries.push(["email address", [{ propertyName: "email", operator: "EQ", value: email }]]);

  for (const [what, f] of tries) {
    const ids = await searchIds("contacts", f);
    if (ids.length > 1) throw new AmbiguousMatch(`Contact ${what}`, ids);
    if (ids.length === 1) {
      const id = ids[0];
      const { firstname, lastname, ...rest } = props;
      const existing = await hs<{ properties: Record<string, string | null> }>("GET", `/crm/v3/objects/contacts/${id}?properties=firstname,lastname`);
      const upd: Record<string, string> = { ...rest };
      if (!existing.properties.firstname && firstname) upd.firstname = firstname;
      if (!existing.properties.lastname && lastname) upd.lastname = lastname;
      await writeContact("PATCH", `/crm/v3/objects/contacts/${id}`, upd);
      return { id, created: false };
    }
  }
  try {
    return { id: (await writeContact("POST", "/crm/v3/objects/contacts", props)).id, created: true };
  } catch (e) {
    const id = holderId(e); // HubSpot search had not indexed an earlier record yet
    if (id) return { id, created: false };
    throw e;
  }
}

/** Looks for a note on this deal that already carries this call's marker. */
async function findNote(dealId: string, callId: string): Promise<string | null> {
  const assoc = await hs<{ results: { toObjectId: number | string }[] }>("GET", `/crm/v4/objects/deals/${dealId}/associations/notes`);
  const ids = assoc.results.map((r) => String(r.toObjectId));
  if (!ids.length) return null;
  const notes = await hs<{ results: { id: string; properties: { hs_note_body?: string } }[] }>("POST", "/crm/v3/objects/notes/batch/read", {
    properties: ["hs_note_body"], inputs: ids.map((id) => ({ id })),
  });
  return notes.results.find((n) => n.properties.hs_note_body?.includes(noteMarker(callId)))?.id ?? null;
}

async function createNote(l: SyncLead, dealId: string, contactId: string | null): Promise<string> {
  const n = await hs<{ id: string }>("POST", "/crm/v3/objects/notes", {
    properties: { hs_note_body: noteBody(l), hs_timestamp: new Date(l.call_time).getTime() },
    associations: [
      { to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] },
      ...(contactId ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] : []),
    ],
  });
  return n.id;
}

function mockSync(l: SyncLead): SyncResult {
  const props = dealProperties(l, "MOCK_PIPELINE", {});
  console.log(`[MOCK HubSpot sync] no request sent. enquiry=${l.enquiry_id} would write ${Object.keys(props).length} deal properties`);
  return { status: "SYNCED", mock: true, contactId: l.hubspot_contact_id ?? `mock-contact-${l.customer_id}`, dealId: l.hubspot_deal_id ?? `mock-deal-${l.enquiry_id}`, noteId: l.hubspot_note_id ?? `mock-note-${l.call_id}`, contactCreated: false, dealCreated: false, noteCreated: false };
}

export async function syncEnquiry(l: SyncLead): Promise<SyncResult> {
  if (syncMode() === "mock") return mockSync(l);

  const pipelineId = env("HUBSPOT_PIPELINE_ID");
  const stageIds = JSON.parse(env("HUBSPOT_STAGE_IDS")) as Record<string, string>;

  let contact: { id: string; created: boolean } | null = null;
  let review: string | undefined;
  try {
    contact = await upsertContact(l);
  } catch (e) {
    if (!(e instanceof AmbiguousMatch)) throw e;
    review = `${e.message}. The call was not attached to any contact; please decide which one it belongs to.`;
  }
  const status = review ? "NEEDS_MATCH_REVIEW" : "SYNCED";
  const meta = syncMeta({ status, error: review ? redact(review) : "" });
  const base = dealProperties(l, pipelineId, stageIds);

  let dealId = l.hubspot_deal_id ?? (await searchDeal(l.enquiry_id));
  let dealCreated = false;
  if (!dealId) {
    try {
      dealId = (await hs<{ id: string }>("POST", "/crm/v3/objects/deals", { properties: { ...base, ...meta } })).id;
      dealCreated = true;
    } catch (e) {
      dealId = holderId(e);
      if (!dealId) throw e;
    }
  }
  if (!dealCreated) {
    const cur = await hs<{ properties: Record<string, string | null> }>("GET", `/crm/v3/objects/deals/${dealId}?properties=aangan_next_action,aangan_followup_date`);
    await hs("PATCH", `/crm/v3/objects/deals/${dealId}`, { properties: { ...updateRules(base, cur.properties), ...meta } });
  }
  if (contact) await hs("PUT", `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contact.id}`);

  // Exactly one note per call: reuse a known id, else look for the call marker, else create.
  let noteId = l.hubspot_note_id ?? (dealCreated ? null : await findNote(dealId, l.call_id));
  const noteCreated = !noteId;
  if (!noteId) noteId = await createNote(l, dealId, contact?.id ?? null);

  return { status, contactId: contact?.id ?? null, dealId, noteId, contactCreated: contact?.created ?? false, dealCreated, noteCreated, review_reason: review };
}

async function searchDeal(enquiryId: string): Promise<string | null> {
  const ids = await searchIds("deals", [{ propertyName: "aangan_neon_enquiry_id", operator: "EQ", value: enquiryId }]);
  return ids[0] ?? null;
}
