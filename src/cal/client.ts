import { env, optionalEnv } from "../config.js";
import { redact } from "../util/redact.js";

const BASE = "https://api.cal.com/v2";
const TIMEOUT_MS = 15_000;
// Versions confirmed against the live API for this account (2026-10-10).
const V_SLOTS = "2024-09-04";
const V_BOOKINGS = "2026-02-25";

export class CalError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(redact(`Cal.com ${status} on ${path}: ${body}`, 300));
  }
}

async function cal<T = any>(method: string, path: string, version: string, body?: unknown, retry = true, attempt = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env("CAL_API_KEY")}`, "cal-api-version": version, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // A timeout on a write may still have been processed: only reads are retried automatically.
    if (retry && attempt < 3) { await sleep(600 * attempt); return cal<T>(method, path, version, body, retry, attempt + 1); }
    throw new CalError(0, e instanceof Error ? e.name : "network error", path);
  }
  if (retry && (res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(800 * attempt); return cal<T>(method, path, version, body, retry, attempt + 1); }
  const text = await res.text();
  if (!res.ok) throw new CalError(res.status, text, path);
  return (text ? JSON.parse(text) : null) as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Slot { startUtc: string; startLocal: string }

/** Real availability from Cal.com: honours working hours, notice, buffers and the connected calendar's conflicts. */
export async function getSlots(fromISO: string, toISO: string, timeZone = "Asia/Kolkata"): Promise<Slot[]> {
  const q = new URLSearchParams({ eventTypeId: env("CAL_EVENT_TYPE_ID"), start: fromISO, end: toISO, timeZone });
  const r = await cal<{ data: Record<string, { start: string }[]> }>("GET", `/slots?${q}`, V_SLOTS);
  return Object.values(r.data).flat().map((s) => ({ startLocal: s.start, startUtc: new Date(s.start).toISOString() })).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export interface Booking {
  uid: string; id: number | null; status: string; start: string; end: string; title: string;
  hostName: string | null; hostEmail: string | null; attendeeEmail: string | null; attendeeName: string | null; attendeeTimeZone: string | null;
  meetingUrl: string | null; description: string | null; duration: number | null; createdAt: string | null;
}

export function normalizeBooking(b: any): Booking {
  const host = b.hosts?.[0] ?? b.organizer ?? null;
  const att = b.attendees?.[0] ?? null;
  return {
    uid: b.uid, id: b.id ?? null, status: String(b.status), start: b.start ?? b.startTime, end: b.end ?? b.endTime, title: b.title ?? "",
    hostName: host?.name ?? null, hostEmail: host?.email ?? null, attendeeEmail: att?.email ?? null, attendeeName: att?.name ?? null, attendeeTimeZone: att?.timeZone ?? null,
    meetingUrl: b.meetingUrl ?? b.location ?? null, description: b.description ?? null, duration: b.duration ?? null, createdAt: b.createdAt ?? null,
  };
}

/** Existing upcoming booking for this attendee at this exact start time (used to prevent duplicates). */
export async function findBooking(attendeeEmail: string, startISO: string): Promise<Booking | null> {
  const t = new Date(startISO).getTime();
  const q = new URLSearchParams({ attendeeEmail, afterStart: new Date(t - 60_000).toISOString(), beforeEnd: new Date(t + 24 * 3600_000).toISOString(), status: "upcoming,unconfirmed" });
  const r = await cal<{ data: any[] }>("GET", `/bookings?${q}`, V_BOOKINGS);
  const hit = r.data.map(normalizeBooking).find((b) => new Date(b.start).getTime() === t && b.status !== "cancelled");
  return hit ?? null;
}

/**
 * Finds the booking made during a call WITHOUT relying on the email the caller gave (voice recognition mishears emails).
 * Matches on the exact start time; if several bookings share that start, the caller's email breaks the tie. A booking is only
 * accepted if it was created no earlier than `notBefore` (the start of the call), so an old booking is never claimed by mistake.
 */
export async function findBookingNear(startISO: string, notBeforeISO: string, emailHint?: string | null): Promise<Booking | null> {
  const t = new Date(startISO).getTime();
  const q = new URLSearchParams({ afterStart: new Date(t - 60_000).toISOString(), beforeEnd: new Date(t + 24 * 3600_000).toISOString(), status: "upcoming,unconfirmed" });
  const r = await cal<{ data: any[] }>("GET", `/bookings?${q}`, V_BOOKINGS);
  const cands = r.data.map(normalizeBooking).filter((b) => new Date(b.start).getTime() === t && b.status.toLowerCase() !== "cancelled"
    && (!b.createdAt || new Date(b.createdAt).getTime() >= new Date(notBeforeISO).getTime()));
  if (cands.length <= 1) return cands[0] ?? null;
  const byEmail = emailHint ? cands.find((b) => b.attendeeEmail?.toLowerCase() === emailHint.toLowerCase()) : null;
  return byEmail ?? null; // ambiguous: do not guess
}

export async function getBooking(uid: string): Promise<Booking> {
  return normalizeBooking((await cal<{ data: any }>("GET", `/bookings/${uid}`, V_BOOKINGS)).data);
}

export async function cancelBooking(uid: string, reason: string): Promise<void> {
  await cal("POST", `/bookings/${uid}/cancel`, V_BOOKINGS, { cancellationReason: reason }, false);
}

export interface BookRequest {
  startISO: string;
  name: string; email: string; timeZone: string; phone?: string | null;
  title: string; notes: string;
  metadata?: Record<string, string>;
}
export type BookOutcome =
  | { ok: true; booking: Booking; alreadyExisted: boolean }
  | { ok: false; reason: "slot_unavailable" | "invalid_request" | "unknown_outcome" | "error"; detail: string };

/**
 * Books exactly one appointment. Cal.com documents no idempotency, so we do it ourselves:
 *  1. if this attendee already has a booking at this start, return it (no second booking);
 *  2. POST; 3. if the POST fails ambiguously (timeout / network / 5xx), look again before reporting anything.
 * Never reports "confirmed" unless Cal.com returned accepted/confirmed.
 */
export async function bookSlot(r: BookRequest): Promise<BookOutcome> {
  const existing = await findBooking(r.email, r.startISO).catch(() => null);
  if (existing) return { ok: true, booking: existing, alreadyExisted: true };
  try {
    const res = await cal<{ data: any }>("POST", "/bookings", V_BOOKINGS, {
      start: new Date(r.startISO).toISOString(),
      eventTypeId: Number(env("CAL_EVENT_TYPE_ID")),
      attendee: { name: r.name, email: r.email, timeZone: r.timeZone, language: "en", ...(r.phone ? { phoneNumber: r.phone } : {}) },
      bookingFieldsResponses: { title: r.title, notes: r.notes },
      metadata: r.metadata ?? {},
    }, false);
    return { ok: true, booking: normalizeBooking(Array.isArray(res.data) ? res.data[0] : res.data), alreadyExisted: false };
  } catch (e) {
    if (e instanceof CalError && (e.status === 400 || e.status === 409)) {
      const unavailable = /not available|already has booking|no_available|conflict|busy|slot/i.test(e.body);
      return { ok: false, reason: unavailable ? "slot_unavailable" : "invalid_request", detail: e.message };
    }
    // Ambiguous failure: it may have gone through. Check before saying anything.
    const again = await findBooking(r.email, r.startISO).catch(() => null);
    if (again) return { ok: true, booking: again, alreadyExisted: true };
    return { ok: false, reason: e instanceof CalError && e.status === 0 ? "unknown_outcome" : "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export const calConfigured = () => !!optionalEnv("CAL_API_KEY") && !!optionalEnv("CAL_EVENT_TYPE_ID");
