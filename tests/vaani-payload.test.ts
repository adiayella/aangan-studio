import { describe, expect, it } from "vitest";
import { parseVaaniEvent, transcriptText } from "../src/vaani/payload.js";

describe("Vaani webhook payloads", () => {
  it("call_started", () => {
    expect(parseVaaniEvent({ event: "call_started", room_name: "room-1", status: "x", phone_number: "+919876543210" })).toEqual({ kind: "call_started", callKey: "room-1", phone: "+919876543210" });
  });
  it("call_ended duration is seconds", () => {
    expect(parseVaaniEvent({ event: "call_ended", room_name: "room-1", call_duration: 187, end_reason: "hangup" })).toMatchObject({ kind: "call_ended", durationSec: 187, endReason: "hangup" });
  });
  it("call_postprocessing: documented nested shape, duration is milliseconds", () => {
    const e = parseVaaniEvent({ event: "call_postprocessing", call_id: "c1", timestamp: "2026-10-10T05:00:00Z", data: { room_name: "room-1", call_id: "c1", call_duration: 187000, summary: "s", transcript: "AGENT: hi\nUSER: hello", recording_url: "https://x/a.mp3" } });
    expect(e).toMatchObject({ kind: "call_postprocessing", callKey: "c1", durationSec: 187, summary: "s", transcript: "AGENT: hi\nUSER: hello" });
  });
  it("call_postprocessing: top-level summary/transcript (the docs' Python sample) also works", () => {
    const e = parseVaaniEvent({ event: "call_postprocessing", call_id: "c1", summary: "s", transcript: "t", data: { call_duration: 60000 } });
    expect(e).toMatchObject({ kind: "call_postprocessing", summary: "s", transcript: "t", durationSec: 60 });
  });
  it("transcript given as turns is converted to AGENT/USER lines", () => {
    expect(transcriptText([{ role: "assistant", text: "Hello" }, { speaker: "user", content: "Hi" }])).toBe("AGENT: Hello\nUSER: Hi");
  });
  it("missing transcript stays null, never invented", () => {
    expect(parseVaaniEvent({ event: "call_postprocessing", call_id: "c1", data: {} })).toMatchObject({ transcript: null, summary: null, durationSec: null });
  });
  it("unknown events are ignored, not errors", () => {
    expect(parseVaaniEvent({ event: "call_ringing", room_name: "r" })).toMatchObject({ kind: "other", event: "call_ringing" });
  });
  it("garbage is rejected", () => {
    expect(() => parseVaaniEvent({ nope: 1 })).toThrow();
    expect(() => parseVaaniEvent({ event: "call_postprocessing" })).toThrow(/without/);
  });
});
