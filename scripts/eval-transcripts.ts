// Runs Gemini extraction + the rules engine over the September phone transcripts and compares to expected verdicts.
// Usage: npx tsx scripts/eval-transcripts.ts
import { readFileSync } from "node:fs";
import { extractFacts, summarize } from "../src/ai/gemini.js";
import { qualify } from "../src/qualification/rules.js";
import { estimateValue } from "../src/value/estimate.js";
import "../src/config.js";

const EXPECTED: Record<string, string> = {
  T01: "QUALIFIED", T02: "QUALIFIED", T03: "UNQUALIFIED", T04: "UNQUALIFIED", T05: "QUALIFIED", T06: "QUALIFIED",
  T07: "UNQUALIFIED", T09: "ESCALATION", T10: "UNQUALIFIED", T12: "QUALIFIED",
  T14: "NEEDS_REVIEW", T17: "QUALIFIED", T18: "NEEDS_REVIEW", T19: "UNQUALIFIED",
  // The callers below never stated a completion date (or, for T16, the project). The rubric says ask one question,
  // so a transcript-only run correctly returns NEEDS_REVIEW; the live agent asks, which resolves it.
  T11: "NEEDS_REVIEW", T13: "NEEDS_REVIEW", T15: "NEEDS_REVIEW", T16: "NEEDS_REVIEW", T20: "NEEDS_REVIEW",
};

const text = readFileSync("tests/fixtures/phone-transcripts.txt", "utf8");
const parts = text.split(/\n(?=T\d\d · Phone)/).filter((p) => /^T\d\d/.test(p));
const only = process.argv[2];

let pass = 0, total = 0;
for (const p of parts) {
  const id = p.slice(0, 3);
  if (!EXPECTED[id] || (only && only !== id)) continue;
  const day = /(\d+) September/.exec(p)?.[1] ?? "1";
  const date = `2026-09-${day.padStart(2, "0")}`;
  const ex = await extractFacts(p, date);
  const q = qualify(ex.facts);
  const ok = q.verdict === EXPECTED[id];
  total++; if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} got=${q.verdict} want=${EXPECTED[id]}  ${ok ? "" : q.explanation}`);
  const est = estimateValue({ ...ex.facts });
  console.log(`   estimate: ${est.status} designed=${est.designed_area_sqft} tier_set=${ex.facts.spec_tier} scenarios=${est.scenarios.length} low=${est.pipeline_low_inr} high=${est.pipeline_high_inr}`);
  if (!ok) console.log("   facts:", JSON.stringify(ex.facts));
  if (id === "T01") console.log("   summary:", await summarize(p));
}
console.log(`\n${pass}/${total} matched`);
