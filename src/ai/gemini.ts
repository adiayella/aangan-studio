import { env, optionalEnv } from "../config.js";
import { EnquiryFactsSchema, type EnquiryFacts } from "../qualification/types.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function generate(body: unknown, attempt = 1): Promise<string> {
  const model = optionalEnv("GEMINI_MODEL", "gemini-3.8-flash");
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return generate(body, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as any;
  const text = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

const nullable = (t: string) => ({ type: [t, "null"] });
const FACTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    existing_client_complaint: { type: "boolean" },
    intent: { type: "string", enum: ["design_and_execution", "advice_only", "self_execution", "unknown"] },
    segment: { type: "string", enum: ["residential", "commercial", "unknown"] },
    commercial_type: { type: ["string", "null"], enum: ["office", "clinic", "studio", "restaurant", "hotel", "retail", "gym", "other", null] },
    area_sqft: nullable("number"),
    rooms_in_scope: nullable("integer"),
    designed_area_sqft: nullable("number"),
    spec_tier: { type: ["string", "null"], enum: ["basic", "standard", "mid_range", "premium", "luxury", null] },
    full_home: nullable("boolean"),
    structural_changes: { type: "boolean" },
    city: nullable("string"),
    locality: nullable("string"),
    deadline_weeks: nullable("number"),
    budget_min_inr: nullable("number"),
    budget_max_inr: nullable("number"),
    decision_maker: { type: "string", enum: ["self", "authorized_rep", "researching_for_other", "unknown"] },
    sentiment: { type: "string", enum: ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"] },
    callback_requested: nullable("boolean"),
    next_action: nullable("string"),
    followup_date: nullable("string"),
    caller_phone: nullable("string"),
    caller_email: nullable("string"),
    consult_mode: { type: ["string", "null"], enum: ["online", "site_visit", null] },
    consult_preferred_start: nullable("string"),
    customer_name: nullable("string"),
    property_type: nullable("string"),
    requirements: nullable("string"),
    deadline_text: nullable("string"),
  },
  required: ["existing_client_complaint", "intent", "segment", "decision_maker"],
};

const EXTRACT_RULES = `You extract facts from a phone call between a caller and Aangan Studio, an interior design and execution studio in Pune, India.
Rules:
- Use ONLY what the caller actually said or clearly confirmed. If something was not stated, use null (or "unknown").
- Never guess a budget. budget_* only if the caller said a number, converted to rupees (1 lakh = 100000).
- intent = "design_and_execution" only if they want a design project carried through to execution (a redesign of rooms, a full home, an office fit-out). "advice_only" for ideas, colour or furniture suggestions, or "just exploring". "self_execution" if they will do the work themselves.
- existing_client_complaint = true only if the caller already has a running project with Aangan and is complaining about it.
- deadline_weeks = weeks from the call date until the caller needs the project finished or the space ready to use. Compute it from the call date. If they only say when they will START or "no rush", use null unless a finish date is stated. "Done by March" from a September call is about 24 weeks.
- decision_maker: "self" if they are the owner/decider; "authorized_rep" if calling for someone who has authorised them; "researching_for_other" if only doing initial checking for someone else who will decide; else "unknown".
- city: "Pune" if the caller or the area is in Pune city; "PCMC" for Pimpri-Chinchwad areas; otherwise the city they name. locality: the neighbourhood.
- area_sqft = carpet area of the whole property if stated. designed_area_sqft = carpet area actually being designed: set it only if the caller states the area being designed, or the whole home/office is in scope (then it equals the total). For a partial project with no stated designed area, use null. Never derive it by guessing.
- spec_tier only if the caller explicitly states a specification level (e.g. "premium finishes", "basic fitout"). Never infer a tier from the neighbourhood, budget or tone; use null.
- sentiment = the CALLER's overall tone: POSITIVE, NEUTRAL, NEGATIVE (frustrated or angry), or UNKNOWN if there is not enough to tell. Never guess; a short or neutral call is UNKNOWN or NEUTRAL, not NEGATIVE.
- callback_requested = true only if the caller asked to be called back or said they will wait for a call. next_action = one short suggested step for the designer, only if the call makes it clear, else null. followup_date = YYYY-MM-DD only if a specific date was agreed, else null.
- caller_phone and caller_email only if the caller actually said them (spelled-out digits and "at ... dot ..." forms count); never invent or complete them. Email as written normally, lower case.
- consult_mode: "site_visit" if they want the designer to visit the property, "online" for a video or phone meeting, else null. consult_preferred_start: the caller's preferred consultation start as an ISO 8601 timestamp in Indian time (+05:30), computed from the call date, ONLY if a specific day and time were stated; otherwise null.
- Do not copy anything the front desk said as if it were the caller's statement.`;

export interface ExtractedCall {
  facts: EnquiryFacts;
  customer_name: string | null;
  property_type: string | null;
  requirements: string | null;
  deadline_text: string | null;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";
  callback_requested: boolean | null;
  next_action: string | null;
  followup_date: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  consult_mode: "online" | "site_visit" | null;
  consult_preferred_start: string | null;
}

export async function extractFacts(transcript: string, callDateISO: string): Promise<ExtractedCall> {
  const text = await generate({
    systemInstruction: { parts: [{ text: EXTRACT_RULES }] },
    contents: [{ parts: [{ text: `Call date: ${callDateISO}\n\nTranscript:\n${transcript}` }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: FACTS_JSON_SCHEMA },
  });
  const raw = JSON.parse(text) as Record<string, unknown>;
  // Drop nulls on non-nullable fields so schema defaults apply.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
  const nullableKeys = ["designed_area_sqft", "spec_tier", "commercial_type", "area_sqft", "rooms_in_scope", "full_home", "city", "locality", "deadline_weeks", "budget_min_inr", "budget_max_inr"];
  for (const k of nullableKeys) if (raw[k] === null) cleaned[k] = null;
  return {
    facts: EnquiryFactsSchema.parse(cleaned),
    customer_name: (raw.customer_name as string) ?? null,
    property_type: (raw.property_type as string) ?? null,
    requirements: (raw.requirements as string) ?? null,
    deadline_text: (raw.deadline_text as string) ?? null,
    sentiment: (["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"].includes(raw.sentiment as string) ? raw.sentiment : "UNKNOWN") as ExtractedCall["sentiment"],
    callback_requested: typeof raw.callback_requested === "boolean" ? raw.callback_requested : null,
    next_action: (raw.next_action as string) ?? null,
    followup_date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.followup_date)) ? String(raw.followup_date) : null,
    caller_phone: (raw.caller_phone as string) ?? null,
    caller_email: (raw.caller_email as string) ?? null,
    consult_mode: raw.consult_mode === "online" || raw.consult_mode === "site_visit" ? raw.consult_mode : null,
    consult_preferred_start: raw.consult_preferred_start && !isNaN(Date.parse(String(raw.consult_preferred_start))) ? String(raw.consult_preferred_start) : null,
  };
}

const SUMMARY_RULES = `Write a 2-4 sentence summary of this phone call for an interior designer who will call the customer next.
Include: who they are, the property and location, what they want, timeline, and anything sensitive (frustration, referral, who decides).
Never mention or imply any price, rate or cost figure. Plain text only, no bullet points.`;

export async function summarize(transcript: string): Promise<string> {
  const out = await generate({
    systemInstruction: { parts: [{ text: SUMMARY_RULES }] },
    contents: [{ parts: [{ text: transcript }] }],
    generationConfig: { temperature: 0.2 },
  });
  return out.trim();
}
