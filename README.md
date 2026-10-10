# Aangan Studio — AI Receptionist

Voice receptionist for Aangan Studio (interior design and execution, Pune). A Vaani voice agent answers calls, a backend
analyses each finished call with Gemini, applies Nikhil's qualification rubric, stores everything in Neon, syncs to HubSpot,
emails the assigned designer, and records Cal.com appointments.

```
Vaani call ──webhook──> /webhooks/vaani/<secret> ──> Gemini (extract facts + summary)
                                                      └─> rubric rules (Qualified / Unqualified / Needs review / Urgent)
                                                          └─> Neon  ──> HubSpot (deal, fields, note)
                                                                   └─> designer email (Resend)
Cal.com booking ─webhook─> /webhooks/cal/<secret>  ──> appointment recorded, HubSpot consultation fields updated
```

## Layout
- `src/qualification/` rubric rules (deterministic; Gemini only extracts facts)
- `src/value/` internal indicative estimates and cost/ROI maths (never shown to callers or designers)
- `src/hubspot/` field schema, mapping, tracked sync, one-time setup
- `src/email/` designer email template, Resend sender, delivery tracking
- `src/cal/` Cal.com v2 client and webhook receiver
- `src/pipeline/processCall.ts` the whole post-call flow
- `src/db/migrations/` Neon schema (run `npm run db:migrate`)
- `web/` Designer Desk (static dashboard, signs in with Neon Auth)
- `api/index.ts` + `vercel.json` Vercel entry point
- `docs/` Vaani agent prompt and HubSpot field mapping
- `scripts/` simulators and live health/verification checks

## Run locally
```
npm install
cp .env.example .env.local      # then fill in values (never commit .env.local)
npm run db:migrate
npm test
npx tsx scripts/simulate-call.ts chat-wakad     # replay a call (HubSpot and email are mocked by default)
npx tsx scripts/health-check.ts                 # read-only check of every integration
```

## Rules built in
- The agent never states a price. Internal estimates exist only in Neon and HubSpot, labelled "INTERNAL INDICATIVE ESTIMATE — NOT A QUOTATION".
- Missing information is never treated as a rejection; unclear budget or decision-maker does not disqualify.
- Qualification, email, appointment and CRM sync are tracked as separate statuses; repeated events create no duplicates.
- Secrets live only in `.env.local` / Vercel environment variables.
