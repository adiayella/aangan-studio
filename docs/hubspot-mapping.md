# HubSpot field mapping (approved)

Object: **Deals** in the "Aangan Enquiries" pipeline. Customer = **Contact**. Call summary = **Note** on both.
Match keys: contact by `aangan_neon_customer_id`, then phone (+91 normalised), then email, never by name.
Deal by `aangan_neon_enquiry_id`. More than one contact matching = **Needs match review** (not attached).

Ownership: **System** = overwritten each sync. **Fill-if-empty** = written only while empty in HubSpot.
**Human** = never written after the deal exists.

| Neon / analysis | HubSpot property | Owner |
|---|---|---|
| Call time, duration, id | `aangan_call_time`, `aangan_call_duration_sec`, `aangan_call_id` | System |
| Category, property, locality, city, areas, scope, timeline | `aangan_category`, `aangan_property_type`, `aangan_locality`, `aangan_city`, `aangan_area_sqft`, `aangan_designed_area_sqft`, `aangan_scope`, `aangan_timeline` | System |
| Five checks + reasons | `aangan_check_*` (PASS/FAIL/UNCERTAIN), `aangan_check_notes` | System |
| Decision, reason, decline category | `aangan_decision`, `aangan_decision_reason`, `aangan_decline_category` | System |
| AI summary, designer, consultation | `aangan_call_summary`, `aangan_designer`, `aangan_consult_*` | System |
| Internal estimate (confidential) | `aangan_est_*` | System |
| Analysis status | `aangan_analysis_status` PENDING / COMPLETED / FAILED | System |
| Call outcome | `aangan_call_outcome` (separate from deal stage) | System; blank if not determinable |
| Sentiment | `aangan_sentiment` POSITIVE / NEUTRAL / NEGATIVE / UNKNOWN | System |
| Priority | `aangan_priority` URGENT / HIGH / NORMAL / LOW | System; blank if analysis missing |
| Next action, follow-up date | `aangan_next_action`, `aangan_followup_date` | **Fill-if-empty** |
| Analysis link | `aangan_analysis_url` | System |
| Sync tracking | `aangan_sync_status` SYNCED / FAILED / NEEDS_MATCH_REVIEW, `aangan_last_synced_at`, `aangan_sync_error` (redacted) | System |
| Deal stage, pipeline, amount | `dealstage`, `pipeline`, `amount` | **Human** (set once at creation) |
| Follow-up status, confirmed value, revenue | `aangan_followup_status`, `aangan_confirmed_deal_value_inr`, `aangan_actual_revenue_inr` | **Human** |

Priority rules: complaint = URGENT; negative sentiment, qualified-but-not-booked, needs-review or missed call = HIGH; unqualified = LOW; otherwise NORMAL.
Outcome precedence: missed, urgent escalation, consultation booked (confirmed only), callback requested, declined, disconnected, information given.
Missing analysis is never treated as negative: sentiment becomes UNKNOWN, outcome and priority are left blank.

Code: `src/analysis/indicators.ts`, `src/hubspot/map.ts` (mapping + update rules), `src/hubspot/sync.ts`, `src/hubspot/track.ts`.
Checks: `npm test` (64 unit tests) and `npx tsx scripts/hubspot-verify.ts` (live, uses ZZ TEST records and deletes them).
