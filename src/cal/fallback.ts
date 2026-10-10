import { optionalEnv } from "../config.js";
import { bookSlot, getSlots, type Booking } from "./client.js";
import { validEmail } from "../hubspot/map.js";

/** Monday to Friday in India time. Weekends are never booked. */
export function isWeekdayIST(iso: string): boolean {
  const d = new Date(new Date(iso).getTime() + 330 * 60 * 1000).getUTCDay();
  return d >= 1 && d <= 5;
}

export interface FallbackInput {
  startISO: string; name: string | null; phone: string | null; callerEmail: string | null; hostFallbackEmail: string | null;
  title: string; notes: string; callKey: string;
}
export type FallbackResult = { booking: Booking | null; detail: string };

/**
 * Post-call safety net: the caller gave a free time but the agent could not book it (no email, mis-heard email, tool error).
 * Books the same slot after the call, on a weekday only, and only if Cal.com still lists it as free. It blocks the designer's calendar;
 * the customer is not emailed an invitation when no usable email was given (the invitation goes to the studio address instead).
 */
export async function bookAfterCall(i: FallbackInput): Promise<FallbackResult> {
  if (optionalEnv("CAL_FALLBACK_BOOKING", "on").toLowerCase() === "off") return { booking: null, detail: "post-call booking switched off" };
  const start = new Date(i.startISO);
  if (isNaN(+start)) return { booking: null, detail: "no usable start time" };
  if (start.getTime() < Date.now() + 5 * 60 * 1000) return { booking: null, detail: "the requested time has already passed" };
  if (!isWeekdayIST(i.startISO)) return { booking: null, detail: "requested time falls on a weekend; bookings are weekdays only" };
  const day = new Date(start.getTime() - 60 * 60 * 1000).toISOString(), end = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  const free = await getSlots(day, end).catch(() => null);
  if (free && !free.some((s) => Math.abs(+new Date(s.startUtc) - +start) < 60 * 1000)) return { booking: null, detail: "that time is not free on the calendar (outside working hours or already taken)" };
  const real = validEmail(i.callerEmail);
  const candidates = [real, optionalEnv("CAL_FALLBACK_EMAIL") || null, i.hostFallbackEmail].filter((e, n, a): e is string => !!e && a.indexOf(e) === n);
  let last = "no email address available for the booking";
  for (const email of candidates) {
    const r = await bookSlot({ startISO: i.startISO, name: i.name ?? "Aangan enquiry", email, timeZone: "Asia/Kolkata", phone: i.phone, title: i.title, notes: i.notes, metadata: { source: "post-call", call: i.callKey } });
    if (r.ok) return { booking: r.booking, detail: `booked after the call${email === real ? "" : " (using the studio address; caller gave no usable email)"}` };
    last = r.detail;
    if (r.reason === "slot_unavailable") break;
  }
  return { booking: null, detail: `could not book: ${last}` };
}
