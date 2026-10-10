import { timingSafeEqual } from "node:crypto";
import express from "express";
import { join } from "node:path";
import { db } from "./db/pool.js";
import { parseCalEvent, recordCalBooking, signatureOk } from "./cal/webhook.js";
import { processPostCall, recordCallEnded, recordCallStarted } from "./pipeline/processCall.js";
import { redact } from "./util/redact.js";
import { parseVaaniEvent } from "./vaani/payload.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// The Designer Desk (static site). It holds no secrets; live data needs a sign-in.
app.use(express.static(join(process.cwd(), "web"), { index: "index.html", maxAge: "5m" }));

app.get("/health", (_req, res) => { res.json({ ok: true }); });

/**
 * Vaani posts call events here. Vaani documents no signature header, so the endpoint is protected by a
 * long random secret in the URL path (set VAANI_WEBHOOK_SECRET). Request bodies are never logged: they contain personal data.
 */
app.post("/webhooks/vaani/:secret", async (req, res) => {
  const expected = process.env.VAANI_WEBHOOK_SECRET;
  if (!expected || expected.length < 24 || !safeEqual(req.params.secret, expected)) { res.status(404).end(); return; }

  let ev;
  try { ev = parseVaaniEvent(req.body); } catch { res.status(400).json({ ok: false, error: "unrecognised event" }); return; }

  try {
    switch (ev.kind) {
      case "call_started": await recordCallStarted(db(), ev.callKey, ev.phone); break;
      case "call_ended": await recordCallEnded(db(), ev.callKey, ev.durationSec, ev.endReason); break;
      case "call_postprocessing": {
        const r = await processPostCall(db(), ev);
        res.json({ ok: true, duplicate: r.duplicate, verdict: r.verdict, failed: r.stages.filter((s) => s.status === "failed").map((s) => s.name) });
        return;
      }
      default: break; // other events are acknowledged and ignored
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("webhook error:", redact(e instanceof Error ? e.message : String(e)));
    res.status(500).json({ ok: false });
  }
});

/**
 * Cal.com posts booking events here (BOOKING_CREATED / REQUESTED / RESCHEDULED / CANCELLED). Protected by the secret in the
 * URL (CAL_WEBHOOK_SECRET); if Cal.com also sends a signature header it must match.
 */
app.post("/webhooks/cal/:secret", async (req, res) => {
  const expected = process.env.CAL_WEBHOOK_SECRET;
  if (!expected || expected.length < 24 || !safeEqual(req.params.secret, expected)) { res.status(404).end(); return; }
  if (!signatureOk((req as any).rawBody, req.header("x-cal-signature-256"), expected)) { res.status(401).json({ ok: false }); return; }
  const ev = parseCalEvent(req.body);
  if (!ev) { res.json({ ok: true, ignored: true }); return; } // pings and non-booking events are acknowledged
  try {
    const r = await recordCalBooking(db(), ev);
    res.json({ ok: true, matched: r.matched, crm: r.crm });
  } catch (e) {
    console.error("cal webhook error:", redact(e instanceof Error ? e.message : String(e)));
    res.status(500).json({ ok: false });
  }
});

export default app;
