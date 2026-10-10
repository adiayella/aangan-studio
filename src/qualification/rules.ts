import type { CriterionResult, EnquiryFacts, QualificationResult, Verdict } from "./types.js";

/**
 * Nikhil's five-criteria rubric (qualified.md) applied to structured facts.
 * Deterministic on purpose: Gemini extracts the facts, this file decides.
 */

const SERVED_CITIES = ["pune", "pcmc", "pimpri", "chinchwad", "pimpri-chinchwad", "pimpri chinchwad"];
const SERVED_LOCALITIES = [
  "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar",
  "hadapsar", "magarpatta", "nibm", "kondhwa", "undri", "shivane", "warje", "erandwane",
  "deccan", "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi", "kharadi", "nanded city",
  "balewadi", "bavdhan", "sus", "pashan", "camp", "yerwada", "mundhwa",
];
const OUT_OF_AREA = ["talegaon", "lonavala", "lonavla", "nashik", "mumbai", "nagpur", "bangalore", "bengaluru", "delhi", "hyderabad", "satara", "kolhapur", "solapur"];
const OUT_OF_SCOPE_COMMERCIAL = ["restaurant", "hotel", "retail", "gym"];

const COMMERCIAL_MAX_SQFT = 3000;
/** Not in services.md; the front desk declined a 180 sq ft pod in T18. Needs Nikhil's confirmation. */
const COMMERCIAL_MIN_SQFT = 500;
const MIN_DEADLINE_WEEKS = 6; // services.md: under 6 weeks is not feasible
const COMFORT_DEADLINE_WEEKS = 8; // qualified.md: site ready within 8-10 weeks

// INTERNAL ONLY (from pricing.md). Used for the "obviously insufficient budget" check.
// Never returned by any API, prompt, email or log.
const FLOOR_SINGLE_AREA_INR = 350_000;
const FLOOR_RES_PER_SQFT = 1800;
const FLOOR_COM_PER_SQFT = 1200;
const CLEARLY_BELOW_RATIO = 0.6;

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const hasAny = (text: string, list: string[]) => list.some((x) => text.includes(x));

function realProject(f: EnquiryFacts): CriterionResult {
  const key = "real_project" as const;
  if (f.intent === "advice_only")
    return { key, status: "fail", reason: "Caller wants advice or ideas only; Aangan does design plus execution." };
  if (f.intent === "self_execution")
    return { key, status: "fail", reason: "Caller plans to execute the work themselves." };
  if (f.commercial_type && OUT_OF_SCOPE_COMMERCIAL.includes(f.commercial_type))
    return { key, status: "fail", reason: `${f.commercial_type} projects are outside Aangan's scope.` };
  if (f.segment === "commercial" && f.area_sqft !== null) {
    if (f.area_sqft > COMMERCIAL_MAX_SQFT)
      return { key, status: "fail", reason: `Commercial space of ${f.area_sqft} sq ft exceeds the ~${COMMERCIAL_MAX_SQFT} sq ft limit.` };
    if (f.area_sqft < COMMERCIAL_MIN_SQFT)
      return {
        key,
        status: "unclear",
        reason: `Commercial space of ${f.area_sqft} sq ft is below the ~${COMMERCIAL_MIN_SQFT} sq ft size the studio usually takes. Flagged for human review.`,
      };
  }
  if (f.intent === "design_and_execution") return { key, status: "pass", reason: "Wants design with execution." };
  return {
    key,
    status: "unclear",
    reason: "Not yet clear whether the caller wants full design and execution.",
    clarifying_question: "Just to check, are you looking for complete design and execution, or only design advice?",
  };
}

function serviceArea(f: EnquiryFacts): CriterionResult {
  const key = "service_area" as const;
  const city = norm(f.city);
  const loc = norm(f.locality);
  const both = `${city} ${loc}`;
  if (hasAny(both, OUT_OF_AREA))
    return { key, status: "fail", reason: `Location (${f.locality ?? f.city}) is outside Pune and PCMC.` };
  if (hasAny(both, SERVED_CITIES) || hasAny(both, SERVED_LOCALITIES))
    return { key, status: "pass", reason: `Location (${f.locality ?? f.city}) is in the service area.` };
  return {
    key,
    status: "unclear",
    reason: "Project location not confirmed.",
    clarifying_question: "Which area or city is the property in?",
  };
}

function timeline(f: EnquiryFacts): CriterionResult {
  const key = "timeline" as const;
  const w = f.deadline_weeks;
  if (w === null)
    return {
      key,
      status: "unclear",
      reason: "No completion timeline given.",
      clarifying_question: "When would you need the project to be complete?",
    };
  if (w < MIN_DEADLINE_WEEKS)
    return { key, status: "fail", reason: `Needs completion in ${w} weeks; design alone takes 3-4 weeks and execution 8-16.` };
  if (w < COMFORT_DEADLINE_WEEKS)
    return { key, status: "unclear", reason: `Needs completion in ${w} weeks; very tight against the usual timeline.`, clarifying_question: "Is there any flexibility on that completion date?" };
  return { key, status: "pass", reason: `Completion in ${w} weeks is workable.` };
}

function budgetFloorInr(f: EnquiryFacts): number {
  if (f.segment === "commercial" && f.area_sqft) return f.area_sqft * FLOOR_COM_PER_SQFT;
  if (f.full_home && f.area_sqft) return f.area_sqft * FLOOR_RES_PER_SQFT;
  return FLOOR_SINGLE_AREA_INR;
}

function budget(f: EnquiryFacts): CriterionResult {
  const key = "budget" as const;
  const volunteered = f.budget_max_inr ?? f.budget_min_inr;
  if (volunteered === null)
    return { key, status: "unclear", reason: "Budget not volunteered; treated as qualified per rubric." };
  const best = f.budget_max_inr ?? volunteered;
  if (best < budgetFloorInr(f) * CLEARLY_BELOW_RATIO)
    return { key, status: "fail", reason: "Volunteered budget is clearly below what a project of this scope requires." };
  return { key, status: "pass", reason: "Volunteered budget is in a plausible range." };
}

function decisionMaker(f: EnquiryFacts): CriterionResult {
  const key = "decision_maker" as const;
  if (f.decision_maker === "self" || f.decision_maker === "authorized_rep")
    return { key, status: "pass", reason: "Caller is the decision-maker or authorised by them." };
  if (f.decision_maker === "researching_for_other")
    return { key, status: "fail", reason: "Caller is researching on behalf of someone who has not authorised them." };
  return { key, status: "unclear", reason: "Decision-maker status not confirmed." };
}

export function qualify(f: EnquiryFacts): QualificationResult {
  if (f.existing_client_complaint) {
    return {
      verdict: "ESCALATION",
      criteria: [],
      explanation: "Existing client with a complaint. Skips new-lead qualification; urgent human callback required.",
      missing: [],
      notes: [],
    };
  }

  const criteria = [realProject(f), serviceArea(f), timeline(f), budget(f), decisionMaker(f)];
  const by = Object.fromEntries(criteria.map((c) => [c.key, c])) as Record<CriterionResult["key"], CriterionResult>;

  const hardFails = (["real_project", "service_area", "timeline", "budget"] as const).filter((k) => by[k].status === "fail");
  const missing = (["real_project", "service_area", "timeline"] as const).filter((k) => by[k].status === "unclear");
  const notes: string[] = [];
  if (by.budget.status === "unclear") notes.push("Budget not discussed.");
  if (by.decision_maker.status === "unclear") notes.push("Decision-maker authorisation not confirmed.");
  if (by.decision_maker.status === "fail") notes.push(by.decision_maker.reason);

  let verdict: Verdict;
  if (hardFails.length > 0) verdict = "UNQUALIFIED";
  else if (missing.length > 0 || by.decision_maker.status === "fail") verdict = "NEEDS_REVIEW";
  else verdict = "QUALIFIED";

  const explanation =
    verdict === "UNQUALIFIED"
      ? `Failed: ${hardFails.map((k) => by[k].reason).join(" ")}`
      : verdict === "NEEDS_REVIEW"
        ? `Needs a human look: ${[...missing.map((k) => by[k].reason), ...(by.decision_maker.status === "fail" ? [by.decision_maker.reason] : [])].join(" ")}`
        : "Passes all criteria that could be assessed.";

  return { verdict, criteria, explanation, missing, notes };
}
