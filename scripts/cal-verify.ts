// Live check of the Cal.com integration with ONE clearly marked test booking.
// Usage: npx tsx scripts/cal-verify.ts [--keep]        book, verify, then cancel (unless --keep)
//        npx tsx scripts/cal-verify.ts --cancel <uid>  cancel a kept test booking
import "../src/config.js";
import { bookSlot, cancelBooking, findBooking, getBooking, getSlots } from "../src/cal/client.js";

const args = process.argv.slice(2);
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";

if (args[0] === "--cancel") {
  await cancelBooking(args[1], "Test booking cleanup");
  console.log("cancelled", args[1], "->", (await getBooking(args[1])).status);
  process.exit(0);
}

const keep = args.includes("--keep");
const email = "ayella.adwaith@gmail.com";
const slots = await getSlots(new Date(Date.now() + 3 * 3600e3).toISOString(), new Date(Date.now() + 6 * 86400e3).toISOString());
check("availability returns real future slots", slots.length > 0, `${slots.length} slots, first ${slots[0] && ist(slots[0].startUtc)}`);
const slot = slots[Math.min(5, slots.length - 1)];

const req = {
  startISO: slot.startUtc, name: "ZZ TEST Receptionist Caller", email, timeZone: "Asia/Kolkata",
  title: "TEST — Aangan consultation — Rahul Verma — 2BHK, Wakad",
  notes: "TEST BOOKING (safe to ignore). Purpose: consultation about a full redesign of a 2BHK in Wakad. Caller: Rahul Verma. Summary: owner, 950 sq ft, move-in by March, wants a site visit.",
  metadata: { source: "aangan-receptionist-test", enquiry: "TEST" },
};
const a = await bookSlot(req);
let uid = "";
if (a.ok) {
  uid = a.booking.uid;
  const b = a.booking;
  check("booking created and status is confirmed by Cal.com", ["accepted", "confirmed"].includes(b.status.toLowerCase()), `status=${b.status}`);
  check("start/end/duration correct", new Date(b.start).getTime() === new Date(slot.startUtc).getTime() && b.duration === 30, `${ist(b.start)} for ${b.duration} min`);
  check("host is the calendar owner", b.hostEmail === "adwaith_ayella@pg27.mesaschool.co", `${b.hostName} <${b.hostEmail}>`);
  check("title says who and why", /Rahul Verma/.test(b.title) && /2BHK/.test(b.title), b.title);
  check("purpose visible in description", /Purpose: consultation/.test(b.description ?? ""), (b.description ?? "(none)").slice(0, 90));
  check("attendee stored", b.attendeeEmail === email && b.attendeeTimeZone === "Asia/Kolkata", `${b.attendeeName} / ${b.attendeeTimeZone}`);
  console.log("      meeting link:", b.meetingUrl ?? "(none returned)", "| uid:", uid);
} else check("booking created", false, `${a.reason}: ${a.detail}`);

if (uid) {
  const dup = await bookSlot(req);
  check("repeated request creates no second booking", dup.ok && dup.alreadyExisted && dup.booking.uid === uid, dup.ok ? `returned existing ${dup.booking.uid}` : dup.detail);
  const after = await getSlots(new Date(Date.now() + 3 * 3600e3).toISOString(), new Date(Date.now() + 6 * 86400e3).toISOString());
  check("booked slot is no longer offered", !after.some((s) => s.startUtc === slot.startUtc), `${slots.length} -> ${after.length} slots`);
  const clash = await bookSlot({ ...req, email: "zz.conflict.test@gmail.com", name: "ZZ TEST Conflict" });
  if (clash.ok) { check("a second caller cannot take the same slot", false, "Cal.com ACCEPTED a conflicting booking; cancelling it"); await cancelBooking(clash.booking.uid, "Test cleanup"); }
  else check("a second caller cannot take the same slot", clash.reason === "slot_unavailable", `${clash.reason}`);
  const fresh = await getBooking(uid);
  check("booking can be read back by id", fresh.uid === uid && fresh.status.toLowerCase() === "accepted", `status=${fresh.status}`);
  const found = await findBooking(email, slot.startUtc);
  check("lookup by attendee + time finds it", found?.uid === uid);
  if (!keep) { await cancelBooking(uid, "Test booking cleanup"); check("test booking cancelled", (await getBooking(uid)).status.toLowerCase() === "cancelled"); }
  else console.log(`\n(kept for calendar check; cancel with: npx tsx scripts/cal-verify.ts --cancel ${uid})`);
}
const bad = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
