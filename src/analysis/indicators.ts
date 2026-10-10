import type { Verdict } from "../qualification/types.js";

/** Deterministic call-outcome and priority indicators. Gemini supplies sentiment; these rules decide the rest. */

export type AnalysisStatus = "PENDING" | "COMPLETED" | "FAILED";
export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";
export type CallOutcome = "CONSULTATION_BOOKED" | "CALLBACK_REQUESTED" | "INFORMATION_GIVEN" | "DECLINED" | "URGENT_ESCALATION" | "DISCONNECTED" | "MISSED";
export type Priority = "URGENT" | "HIGH" | "NORMAL" | "LOW";

export interface AnalysisInput {
  call_status: "completed" | "disconnected" | "missed" | "failed";
  /** null until analysis has run; "failed" if it errored. */
  analysis: "pending" | "done" | "failed";
  verdict: Verdict | null;
  consult_status: "none" | "pending" | "confirmed" | "completed" | "cancelled";
  callback_requested: boolean | null;
  sentiment: Sentiment | null;
}

export interface Indicators {
  analysis_status: AnalysisStatus;
  outcome: CallOutcome | null; // null = not determinable; never guessed
  priority: Priority | null;
  sentiment: Sentiment;
}

export function indicators(i: AnalysisInput): Indicators {
  const analysis_status: AnalysisStatus = i.analysis === "done" ? "COMPLETED" : i.analysis === "failed" ? "FAILED" : "PENDING";
  const sentiment: Sentiment = i.analysis === "done" && i.sentiment ? i.sentiment : "UNKNOWN";

  // Call-level facts do not need the analysis: a missed call is missed regardless.
  if (i.call_status === "missed") return { analysis_status, outcome: "MISSED", priority: "HIGH", sentiment };
  if (i.analysis !== "done") return { analysis_status, outcome: i.call_status === "disconnected" ? "DISCONNECTED" : null, priority: null, sentiment };

  let outcome: CallOutcome;
  if (i.verdict === "ESCALATION") outcome = "URGENT_ESCALATION";
  else if (i.consult_status === "confirmed" || i.consult_status === "completed") outcome = "CONSULTATION_BOOKED";
  else if (i.callback_requested) outcome = "CALLBACK_REQUESTED";
  else if (i.verdict === "UNQUALIFIED") outcome = "DECLINED";
  else if (i.call_status === "disconnected") outcome = "DISCONNECTED";
  else outcome = "INFORMATION_GIVEN";

  let priority: Priority = "NORMAL";
  if (i.verdict === "ESCALATION") priority = "URGENT";
  else if (i.verdict === "UNQUALIFIED") priority = "LOW";
  else if (sentiment === "NEGATIVE") priority = "HIGH";
  else if (i.verdict === "QUALIFIED" && i.consult_status !== "confirmed" && i.consult_status !== "completed") priority = "HIGH";
  else if (i.verdict === "NEEDS_REVIEW" || outcome === "DISCONNECTED") priority = "HIGH";

  return { analysis_status, outcome, priority, sentiment };
}
