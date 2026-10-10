import { z } from "zod";

/**
 * Vaani webhook events (docs.vaanivoice.ai/guides/webhook-setup). The docs contradict themselves on where
 * `summary` and `transcript` sit in call_postprocessing (top level vs inside `data`), so both are accepted.
 * Durations: call_ended.call_duration is SECONDS; call_postprocessing data.call_duration is MILLISECONDS.
 */
const Raw = z.object({ event: z.string() }).passthrough();

export type VaaniEvent =
  | { kind: "call_started"; callKey: string; phone: string | null }
  | { kind: "call_ended"; callKey: string; durationSec: number | null; endReason: string | null }
  | { kind: "call_postprocessing"; callKey: string; durationSec: number | null; endReason: string | null; summary: string | null; transcript: string | null; entities: unknown; dispositions: unknown; recordingUrl: string | null; at: string | null }
  | { kind: "other"; event: string; callKey: string | null };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);

/** Accepts a plain string, or an array of turns like {role|speaker, text|content|message}. */
export function transcriptText(t: unknown): string | null {
  if (typeof t === "string") return t.trim() || null;
  if (!Array.isArray(t)) return null;
  const lines = t.map((x: any) => {
    const who = String(x?.role ?? x?.speaker ?? x?.from ?? "").toLowerCase();
    const text = str(x?.text) ?? str(x?.content) ?? str(x?.message);
    if (!text) return null;
    return `${/agent|assistant|ai|bot/.test(who) ? "AGENT" : "USER"}: ${text}`;
  }).filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

export function parseVaaniEvent(body: unknown): VaaniEvent {
  const top = Raw.parse(body) as Record<string, any>;
  const data: Record<string, any> = top.data && typeof top.data === "object" ? top.data : {};
  const pick = (k: string) => data[k] ?? top[k];
  const callKey = str(pick("call_id")) ?? str(pick("room_name"));

  switch (top.event) {
    case "call_started":
      if (!callKey) throw new Error("call_started without room_name or call_id");
      return { kind: "call_started", callKey, phone: str(pick("phone_number")) };
    case "call_ended": {
      if (!callKey) throw new Error("call_ended without room_name or call_id");
      const d = num(pick("call_duration"));
      return { kind: "call_ended", callKey, durationSec: d === null ? null : Math.round(d), endReason: str(pick("end_reason")) };
    }
    case "call_postprocessing": {
      if (!callKey) throw new Error("call_postprocessing without call_id or room_name");
      const raw = num(pick("call_duration"));
      // Vaani's docs say milliseconds, but the live webhook sent seconds (191 for a 3:11 call). A call over 20,000 seconds
      // (5.5 hours) is not plausible, so larger numbers are treated as milliseconds.
      const durationSec = raw === null ? null : Math.round(raw >= 20000 ? raw / 1000 : raw);
      return {
        kind: "call_postprocessing", callKey, durationSec,
        endReason: str(pick("end_reason")), summary: str(pick("summary")), transcript: transcriptText(pick("transcript")),
        entities: pick("entities") ?? pick("entity") ?? null, dispositions: pick("dispositions") ?? null,
        recordingUrl: str(pick("recording_url")), at: str(top.timestamp) ?? (typeof top.timestamp === "number" ? new Date(top.timestamp).toISOString() : null),
      };
    }
    default:
      return { kind: "other", event: top.event, callKey };
  }
}
