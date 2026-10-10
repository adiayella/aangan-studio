import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCalEvent, signatureOk } from "../src/cal/webhook.js";

const created = { triggerEvent: "BOOKING_CREATED", createdAt: "2026-10-12T05:00:00Z", payload: {
  uid: "abc123", title: "30 min meeting between Adwaith Ayella and Priya", status: "ACCEPTED", startTime: "2026-10-13T09:30:00Z", endTime: "2026-10-13T10:00:00Z",
  organizer: { name: "Adwaith Ayella", email: "adwaith_ayella@pg27.mesaschool.co", timeZone: "Asia/Kolkata" },
  attendees: [{ name: "Priya Sathe", email: "Priya@Gmail.com", timeZone: "Asia/Kolkata" }], metadata: { videoCallUrl: "https://app.cal.com/video/abc123" } } };

describe("Cal.com webhook parsing", () => {
  it("BOOKING_CREATED -> confirmed, email lower-cased, link kept", () => {
    expect(parseCalEvent(created)).toMatchObject({ uid: "abc123", status: "confirmed", attendeeEmail: "priya@gmail.com", attendeeTimeZone: "Asia/Kolkata", meetingUrl: "https://app.cal.com/video/abc123", hostEmail: "adwaith_ayella@pg27.mesaschool.co" });
  });
  it("BOOKING_REQUESTED -> pending, never confirmed", () => {
    expect(parseCalEvent({ ...created, triggerEvent: "BOOKING_REQUESTED", payload: { ...created.payload, status: "PENDING" } })?.status).toBe("pending");
  });
  it("a PENDING status inside BOOKING_CREATED is not treated as confirmed", () => {
    expect(parseCalEvent({ ...created, payload: { ...created.payload, status: "PENDING" } })?.status).toBe("pending");
  });
  it("cancelled and rejected", () => {
    expect(parseCalEvent({ ...created, triggerEvent: "BOOKING_CANCELLED" })?.status).toBe("cancelled");
    expect(parseCalEvent({ ...created, triggerEvent: "BOOKING_REJECTED" })?.status).toBe("rejected");
  });
  it("reschedule keeps a pointer to the old booking", () => {
    expect(parseCalEvent({ ...created, triggerEvent: "BOOKING_RESCHEDULED", payload: { ...created.payload, uid: "new1", rescheduleUid: "abc123" } })).toMatchObject({ uid: "new1", rescheduledFromUid: "abc123" });
  });
  it("pings and non-booking events are ignored, not errors", () => {
    expect(parseCalEvent({ triggerEvent: "PING", payload: {} })).toBeNull();
    expect(parseCalEvent({ triggerEvent: "MEETING_ENDED", payload: { uid: "x" } })).toBeNull();
    expect(parseCalEvent({})).toBeNull();
  });
});

describe("Cal.com signature", () => {
  const secret = "s".repeat(40), raw = Buffer.from(JSON.stringify(created));
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  it("accepts a correct signature and rejects a wrong one", () => {
    expect(signatureOk(raw, sig, secret)).toBe(true);
    expect(signatureOk(raw, "0".repeat(64), secret)).toBe(false);
    expect(signatureOk(Buffer.from("tampered"), sig, secret)).toBe(false);
  });
  it("no header: allowed (the secret in the URL is the primary guard)", () => {
    expect(signatureOk(raw, undefined, secret)).toBe(true);
  });
});
