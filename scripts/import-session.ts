// Imports one finished Vaani session (e.g. a test chat copied from the Vaani History page) through the real pipeline.
// Usage: npx tsx scripts/import-session.ts <transcript.txt> <room-id> <ISO start> <duration-sec> [actual-cost-inr] [--mock-hubspot]
import { readFileSync } from "node:fs";
import "../src/config.js";

const [file, key, startedAt, dur, cost] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mock = process.argv.includes("--mock-hubspot");
process.env.HUBSPOT_SYNC_MODE = mock ? "mock" : "live";
process.env.EMAIL_MODE = process.argv.includes("--live-email") ? "live" : "mock";

const { db, closeDb } = await import("../src/db/pool.js");
const { processPostCall } = await import("../src/pipeline/processCall.js");
const { parseVaaniEvent } = await import("../src/vaani/payload.js");

const ev = parseVaaniEvent({ event: "call_postprocessing", call_id: key, timestamp: startedAt, data: { room_name: key, call_id: key, call_duration: Number(dur) * 1000, end_reason: "session_ended", summary: "", transcript: readFileSync(file, "utf8") } });
if (ev.kind !== "call_postprocessing") throw new Error("bad event");
console.log(`Importing ${key} (HubSpot ${mock ? "MOCK" : "LIVE"})\n`);
const r = await processPostCall(db(), ev, { vaaniActualCostInr: cost ? Number(cost) : null });
for (const s of r.stages) console.log(`  [${s.status.toUpperCase().padEnd(14)}] ${s.name}: ${s.detail}`);
if (r.enquiryId) console.log(`\nenquiry ${r.enquiryId}`);
await closeDb();
