# How to use the Aangan AI receptionist

## What happens on every call (nothing for you to do)
1. A caller reaches the **Vaani** voice agent. It asks about the project, one question at a time, and **never states a price**.
2. If the project is a fit, it asks which day and time the caller is free, checks the real **Cal.com** calendar, and books the slot quietly. **It never tells the caller the slot is confirmed.**
3. When the call ends, Vaani sends the transcript to our server (Vercel). **Gemini** extracts the facts and the fixed rubric decides:
   - **Selected** (all criteria met) · **Needs review** (information missing) · **Declined** (a criterion clearly fails) · **Urgent** (an existing client complaining).
4. The result is saved in **Neon**, a deal is created in **HubSpot**, and (Selected / Needs review only) the **assigned designer is emailed**, saying the calendar is booked.

## Where to look
| Who | Where | What they see |
|---|---|---|
| Founder | **Team link** (private dashboard link) and **HubSpot** → Sales → Deals → pipeline "Aangan Enquiries" | Every enquiry, filters Selected / Needs review / Declined / Urgent, appointments, why each decision was made |
| Designer | Their own **designer link**, plus the **email** they receive | Only their leads: summary, the five checks, appointment time and meeting link |
| Anyone without a link | The plain address | Clearly labelled **sample** data only |

Dashboard address: https://aangan-receptionist-one.vercel.app (open your link once; the device remembers it. **Sign out** forgets it.)
Links live in `docs/desk-links.local.txt` (git-ignored). Treat them like passwords.

## Daily use
- **Designer:** open the email, call the customer to **confirm the appointment** (the customer was not told it was booked), join the meeting from the calendar entry, then set the lead's **stage** in the dashboard (Contacted → Consultation scheduled → Consultation done → Won / Lost).
- **Founder:** open the team link, use the **Declined** and **Urgent** filters. Urgent complaints are not emailed to anyone: they appear at the top of the list and in HubSpot as an urgent escalation.
- Pricing is only ever discussed by the designer at the consultation.

## Admin tasks (ask Claude, or run the command)
| Task | Command |
|---|---|
| Check every integration (read-only) | `npx tsx scripts/health-check.ts` |
| Full live test of a call (books a test slot, cleans up after) | `npx tsx scripts/prod-flow-check.ts` |
| Replay a past call safely (HubSpot and email mocked) | `npx tsx scripts/simulate-call.ts T01` |
| Run the automated tests | `npm test` |
| New link for a designer | `npx tsx scripts/desk-link.ts designer name@email.com` |
| New team link | `npx tsx scripts/desk-link.ts team "Team view"` |
| Cancel a link | `npx tsx scripts/desk-link.ts revoke "<label>"` |
| Deploy changes | `npx vercel deploy --prod --yes` (then `git push`) |

**Adding a designer:** insert a row in the Neon `designers` table (name, email), then create their link. The next qualified lead goes to the designer with the fewest open leads.

## Settings that live outside the code
- **Vaani agent** `aangan-receptionist`: prompt in `docs/voice-vaani-system-prompt.md`; tools `Check_availability_booking` and `book_appointment` (event type 7423691, Asia/Kolkata); webhook "aangan-receptionist" (events: Call Started, Call Ended, Call Post-Processing).
- **Cal.com:** webhook to our server (booking created / requested / rescheduled / cancelled); working hours Mon-Fri 9-5 IST.
- **HubSpot:** pipeline "Aangan Enquiries" and the "Aangan" field groups (mapping in `docs/hubspot-mapping.md`). Change the company currency to INR in HubSpot settings.
- **Secrets:** only in `.env.local` and Vercel environment variables. Never in chat or git.

## If something goes wrong
- **A lead has no designer:** it appears as Unassigned (team link) and in HubSpot; no email is sent.
- **Email failed:** the dashboard shows the designer-email status; failed sends are kept and can be retried.
- **Booking says "requested, not on the calendar":** the caller gave a time but no booking was found for it. Call the customer and book by hand.
- **A mis-heard email in the call:** the booking is matched by time slot, so the designer email still goes out. Cal.com refuses emails on non-existent domains, so such a booking may fail; the lead is still saved.

## Not finished yet
- A **phone number** for the voice agent (Vaani, your decision; may cost money). Until then, test with Vaani's **Audio** test button.
- **Resend domain:** until a domain is verified, only your own address can receive emails.
- **Rotate** every key that was pasted in chat (HubSpot, Neon, Gemini, Resend, Cal.com, the Vaani webhook secret).
