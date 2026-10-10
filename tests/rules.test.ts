import { describe, expect, it } from "vitest";
import { qualify } from "../src/qualification/rules.js";
import { EnquiryFactsSchema } from "../src/qualification/types.js";

const facts = (o: Record<string, unknown>) => EnquiryFactsSchema.parse(o);

// Facts below are hand-extracted from the September phone transcripts (T01-T20).
describe("qualification rules vs September phone transcripts", () => {
  it("T01 Kothrud 3BHK full redesign -> QUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "residential", area_sqft: 1400, full_home: true, city: "Pune", locality: "Kothrud", deadline_weeks: 24, decision_maker: "authorized_rep" }));
    expect(r.verdict).toBe("QUALIFIED");
  });
  it("T02 pricing question does not disqualify", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "residential", area_sqft: 950, full_home: true, locality: "Wakad", deadline_weeks: 8, decision_maker: "self" }));
    expect(r.verdict).toBe("QUALIFIED");
  });
  it("T03 Nashik -> UNQUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", city: "Nashik" }));
    expect(r.verdict).toBe("UNQUALIFIED");
  });
  it("T04 advice only -> UNQUALIFIED", () => {
    expect(qualify(facts({ intent: "advice_only" })).verdict).toBe("UNQUALIFIED");
  });
  it("T06 startup office 800 sq ft Baner -> QUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "commercial", commercial_type: "office", area_sqft: 800, locality: "Baner", deadline_weeks: 12, decision_maker: "self" }));
    expect(r.verdict).toBe("QUALIFIED");
  });
  it("T07 Diwali in 3 weeks -> UNQUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", city: "Pune", deadline_weeks: 3 }));
    expect(r.verdict).toBe("UNQUALIFIED");
  });
  it("T09 existing client complaint -> ESCALATION", () => {
    expect(qualify(facts({ existing_client_complaint: true })).verdict).toBe("ESCALATION");
  });
  it("T10 Rs 1-1.5 lakh for kitchen+bedroom -> UNQUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "residential", rooms_in_scope: 2, locality: "Kharadi", budget_min_inr: 100000, budget_max_inr: 150000, deadline_weeks: 12 }));
    expect(r.verdict).toBe("UNQUALIFIED");
  });
  it("T11 rented flat is fine -> QUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", locality: "Baner", deadline_weeks: 12, decision_maker: "self" }));
    expect(r.verdict).toBe("QUALIFIED");
  });
  it("T12 5,500 sq ft villa residential has no size cap -> QUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "residential", area_sqft: 5500, locality: "Kalyani Nagar", deadline_weeks: 24, decision_maker: "self" }));
    expect(r.verdict).toBe("QUALIFIED");
  });
  it("T14 son researching for parents -> NEEDS_REVIEW", () => {
    const r = qualify(facts({ intent: "design_and_execution", locality: "Hadapsar", deadline_weeks: 20, decision_maker: "researching_for_other" }));
    expect(r.verdict).toBe("NEEDS_REVIEW");
  });
  it("T18 180 sq ft pod -> NEEDS_REVIEW (min size unconfirmed)", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "commercial", commercial_type: "other", area_sqft: 180, city: "Pune", deadline_weeks: 12, decision_maker: "self" }));
    expect(r.verdict).toBe("NEEDS_REVIEW");
  });
  it("T19 restaurant -> UNQUALIFIED", () => {
    const r = qualify(facts({ intent: "design_and_execution", segment: "commercial", commercial_type: "restaurant", locality: "Koregaon Park" }));
    expect(r.verdict).toBe("UNQUALIFIED");
  });
  it("incomplete caller -> NEEDS_REVIEW with questions", () => {
    const r = qualify(facts({}));
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.missing).toEqual(["real_project", "service_area", "timeline"]);
  });
  it("unknown budget and decision-maker do not block", () => {
    const r = qualify(facts({ intent: "design_and_execution", locality: "Aundh", deadline_weeks: 16 }));
    expect(r.verdict).toBe("QUALIFIED");
    expect(r.notes.length).toBe(2);
  });
  it("never leaks pricing numbers in output", () => {
    const r = JSON.stringify(qualify(facts({ intent: "design_and_execution", rooms_in_scope: 2, locality: "Baner", budget_max_inr: 100000, deadline_weeks: 12 })));
    expect(r).not.toMatch(/1800|2400|3500|350000|lakh/i);
  });
});
