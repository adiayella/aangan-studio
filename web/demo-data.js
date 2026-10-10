// Demo leads modelled on the September phone transcripts. Fake contact details; shown only when not connected.
const H = 3600e3, D = 24 * H;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();
const c = (a, b, d, e, f) => [
  { key: "real_project", label: "Real project", status: a[0], reason: a[1] },
  { key: "service_area", label: "Service area", status: b[0], reason: b[1] },
  { key: "timeline", label: "Timeline", status: d[0], reason: d[1] },
  { key: "budget", label: "Budget", status: e[0], reason: e[1] },
  { key: "decision_maker", label: "Decision-maker", status: f[0], reason: f[1] },
];
const NB = ["unclear", "Budget not discussed; treated as qualified."];

export const DESIGNERS = ["Aryan Kulkarni", "Meera Phadke", "Rohan Iyer"];

export const DEMO_LEADS = [
  {
    id: "d1", created_at: ago(2 * H), designer_name: "Aryan Kulkarni",
    customer_name: "Priya Sathe", phone: "+91 98XXXXXX01", email: "priya@example.com",
    locality: "Kothrud", city: "Pune", segment: "residential", property_type: "3BHK apartment", area_sqft: 1400,
    requirements: "Full redo: kitchen, living room, both bedrooms. Flat still has builder finish.",
    deadline_text: "Done by March", verdict: "QUALIFIED",
    criteria: c(["pass", "Wants design with execution."], ["pass", "Kothrud is in the service area."], ["pass", "About 24 weeks available."], NB, ["pass", "Owner; husband agrees."]),
    notes: ["Budget not discussed."],
    summary: "Priya owns a 3BHK in Dahanukar Colony, Kothrud (about 1,400 sq ft carpet) and wants a complete redesign of the kitchen, living room and both bedrooms. Referred by a past client, Shruti Joshi. No rush; target March. Her husband is on board.",
    stage: "new", consult_start: ahead(2 * D + 10 * H), consult_mode: "site_visit", consult_location: "Dahanukar Colony, Kothrud", consult_status: "confirmed", meet_link: null,
    call_duration_sec: 252, hubspot_url: "#", email_status: "sent",
  },
  {
    id: "d2", created_at: ago(5 * H), designer_name: "Aryan Kulkarni",
    customer_name: "Pooja Rane", phone: "+91 98XXXXXX02", email: "pooja@example.com",
    locality: "Magarpatta", city: "Pune", segment: "residential", property_type: "2BHK apartment", area_sqft: 900,
    requirements: "Kitchen, both bedrooms, living room. Both spouses want to attend.",
    deadline_text: "Execution from January", verdict: "QUALIFIED",
    criteria: c(["pass", "Wants design with execution."], ["pass", "Magarpatta is in the service area."], ["pass", "Workable."], NB, ["pass", "Owner with husband."]),
    notes: ["Budget not discussed."],
    summary: "Pooja and her husband own a 900 sq ft 2BHK in Magarpatta and want the kitchen, bedrooms and living room designed. January start for execution suits the timeline.",
    stage: "contacted", consult_start: ahead(4 * D + 6 * H), consult_mode: "online", consult_location: null, consult_status: "pending", meet_link: null,
    call_duration_sec: 284, hubspot_url: "#", email_status: "sent",
  },
  {
    id: "d3", created_at: ago(26 * H), designer_name: "Meera Phadke",
    customer_name: "Anand Sharma", phone: "+91 98XXXXXX03", email: "anand@example.com",
    locality: "Kalyani Nagar", city: "Pune", segment: "residential", property_type: "Villa, G+2", area_sqft: 5500,
    requirements: "End-to-end design of a new, empty villa. Wants the principal designer on site for the first meeting.",
    deadline_text: "Move in by March", verdict: "QUALIFIED",
    criteria: c(["pass", "Wants design with execution."], ["pass", "Kalyani Nagar is in the service area."], ["pass", "About 24 weeks available."], NB, ["pass", "Owner."]),
    notes: ["Budget not discussed.", "Asked for the principal designer."],
    summary: "Anand took possession of a new 5,500 sq ft villa last month. It is completely empty. He wants full end-to-end design and a site visit with the principal designer this week or next.",
    stage: "consult_scheduled", consult_start: ahead(1 * D + 4 * H), consult_mode: "site_visit", consult_location: "Kalyani Nagar villa", consult_status: "confirmed", meet_link: null,
    call_duration_sec: 450, hubspot_url: "#", email_status: "sent",
  },
  {
    id: "d4", created_at: ago(30 * H), designer_name: "Rohan Iyer",
    customer_name: "Girish Nair", phone: "+91 98XXXXXX04", email: "",
    locality: "Viman Nagar", city: "Pune", segment: "residential", property_type: "3BHK apartment", area_sqft: null,
    requirements: "Called Monday, nobody followed up. Wants to book a consultation.",
    deadline_text: "Not stated", verdict: "NEEDS_REVIEW",
    criteria: c(["pass", "Wants design with execution."], ["pass", "Viman Nagar is in the service area."], ["unclear", "No completion timeline given."], NB, ["unclear", "Not confirmed."]),
    notes: ["Frustrated: earlier enquiry was lost. Handle with care.", "Email missing, so no calendar invite sent."],
    summary: "Girish first called on Monday about a 3BHK in Viman Nagar and heard nothing for two days. He called again upset. Timeline and email were not captured. Please call him back personally.",
    stage: "new", consult_start: null, consult_mode: null, consult_location: null, consult_status: "none", meet_link: null,
    call_duration_sec: 318, hubspot_url: "#", email_status: "sent",
  },
  {
    id: "d5", created_at: ago(3 * D), designer_name: "Aryan Kulkarni",
    customer_name: "Aarti Mehta", phone: "+91 98XXXXXX05", email: "aarti@example.com",
    locality: "Koregaon Park", city: "Pune", segment: "residential", property_type: "4BHK apartment", area_sqft: 2400,
    requirements: "Complete redesign including new flooring, kitchen and four bedrooms. Family has moved out temporarily.",
    deadline_text: "Back in by February", verdict: "QUALIFIED",
    criteria: c(["pass", "Wants design with execution."], ["pass", "In the service area."], ["pass", "About 16 weeks."], NB, ["pass", "Owner."]),
    notes: ["Referred by a friend of Nikhil."],
    summary: "Aarti has a 2,400 sq ft 4BHK in Koregaon Park and wants a complete redesign. Wants a site visit. Referred by Vikram Agarwal, a friend of Nikhil.",
    stage: "consult_done", consult_start: ago(1 * D), consult_mode: "site_visit", consult_location: "Koregaon Park", consult_status: "confirmed", meet_link: null,
    call_duration_sec: 404, hubspot_url: "#", email_status: "sent",
  },
  {
    id: "d6", created_at: ago(1 * H), designer_name: "Meera Phadke",
    customer_name: "Sheetal Deshpande", phone: "+91 98XXXXXX06", email: "",
    locality: "Viman Nagar", city: "Pune", segment: "residential", property_type: "2BHK (existing project)", area_sqft: null,
    requirements: "Existing client. Designer Aryan has not replied for five days.",
    deadline_text: "n/a", verdict: "ESCALATION",
    criteria: [], notes: ["Wants a callback from Nikhil or a senior person within 15 minutes."],
    summary: "Sheetal's project is three months in. She messaged three times and called twice with no reply from her designer. She asked for a callback from Nikhil or a senior person.",
    stage: "new", consult_start: null, consult_mode: null, consult_location: null, consult_status: "none", meet_link: null,
    call_duration_sec: 352, hubspot_url: "#", email_status: "sent",
  },
];
