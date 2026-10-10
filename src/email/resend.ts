import { optionalEnv } from "../config.js";
import { redact } from "../util/redact.js";
import type { Rendered } from "./templates.js";

const URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export const emailMode = (): "live" | "mock" => {
  const m = optionalEnv("EMAIL_MODE");
  if (m === "live" || m === "mock") return m;
  return optionalEnv("RESEND_API_KEY") ? "live" : "mock";
};

export interface SendResult { ok: boolean; id?: string; error?: string; mock?: boolean; to: string; redirected: boolean }

/**
 * Sends via Resend. `idempotencyKey` makes a retried send safe: Resend returns the first result instead of sending twice.
 * Until a sending domain is verified, Resend only delivers to the account owner's own address, so EMAIL_REDIRECT_TO can
 * send everything there; the subject then shows who it would have gone to.
 */
export async function sendEmail(to: string, mail: Rendered, idempotencyKey: string, attempt = 1): Promise<SendResult> {
  const redirect = optionalEnv("EMAIL_REDIRECT_TO");
  const actualTo = redirect || to;
  const redirected = !!redirect && redirect !== to;
  const tag = optionalEnv("EMAIL_SUBJECT_PREFIX");
  const subject = `${tag}${redirected ? `[TEST — for ${to}] ` : ""}${mail.subject}`;
  if (emailMode() === "mock") {
    console.log(`[MOCK email] not sent. to=${actualTo} subject="${subject}"`);
    return { ok: true, mock: true, to: actualTo, redirected };
  }
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${optionalEnv("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: optionalEnv("EMAIL_FROM", "Aangan Studio <onboarding@resend.dev>"), to: [actualTo], subject, html: mail.html, text: mail.text,
        headers: mail.priority === "high" ? { "X-Priority": "1", Importance: "high" } : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return sendEmail(to, mail, idempotencyKey, attempt + 1);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: redact(`Resend ${res.status}: ${body.message ?? "error"}`), to: actualTo, redirected };
    return { ok: true, id: body.id, to: actualTo, redirected };
  } catch (e) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 800 * attempt)); return sendEmail(to, mail, idempotencyKey, attempt + 1); }
    return { ok: false, error: redact(`Resend request failed: ${e instanceof Error ? e.name : "error"}`), to: actualTo, redirected };
  }
}
