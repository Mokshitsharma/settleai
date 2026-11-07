# Impact evidence pack

Purpose: show judges, briefly and honestly, that the problem is real for the people SettleAI is for: gig workers who are paid
late or not at all, and small businesses that pay up front with no proof or recourse.

Rules for this pack:

- **No invented numbers or quotes.** Every statistic below carries its source. Every quote comes from a real conversation
  recorded in `interviews/`, with the person's consent, and is attributed by role and city only, never by name.
- **Placeholders stay visible** (`{{...}}`) until real answers replace them. Nothing here is submitted while a placeholder
  remains.
- **Say what the evidence is:** 3 to 5 conversations are signals, not a survey. Present them that way.

## 1. The problem, in published numbers

Re-check each source before quoting it; mark the date you checked.

| Claim | Figure | Source | Checked |
|---|---|---|---|
| Size of India's gig workforce | 7.7 million in 2020-21, projected 23.5 million by 2029-30 | NITI Aayog, *India's Booming Gig and Platform Economy* (June 2022); [PIB release](https://pib.gov.in/PressReleasePage.aspx?PRID=1837277) | 7 Nov 2026, via search results; primary document not re-read |
| Freelancers who struggle to get paid (US) | 1 in 2 had trouble getting paid in a year; nonpayment cost the average respondent 13% of income | Freelancers Union nonpayment survey of 5,358 freelancers ([report PDF](https://onlabor.org/wp-content/uploads/2017/05/FU_NonpaymentReport_r3.pdf)) | 7 Nov 2026, via search results; primary document not re-read |
| Late or unpaid work (New York) | 74% had experienced nonpayment or late payment | NYC Mayor's Office, *Freelancing in New York* (2019, [PDF](https://www.nyc.gov/assets/mome/pdf/freelancing-ny-report-09062019.pdf)) | 7 Nov 2026, via search results; primary document not re-read |

Use the US figures as context, not as India figures. No India-specific primary source on late payment was found, so none is
quoted.

## 2. What we heard: conversations

Target: 3 to 5 conversations, mixed between delivery drivers or couriers and small shopkeepers who pay for delivery or
small jobs. Use [INTERVIEW-GUIDE.md](INTERVIEW-GUIDE.md). Store each as `interviews/NN-role-city.md` from
[interviews/TEMPLATE.md](interviews/TEMPLATE.md).

| # | Role | City | Date | Key finding (one line) | Quote approved for use |
|---|---|---|---|---|---|
| 1 | {{role}} | {{city}} | 7 Nov 2026, via search results; primary document not re-read | {{finding}} | {{yes / no}} |
| 2 | {{role}} | {{city}} | 7 Nov 2026, via search results; primary document not re-read | {{finding}} | {{yes / no}} |
| 3 | {{role}} | {{city}} | 7 Nov 2026, via search results; primary document not re-read | {{finding}} | {{yes / no}} |
| 4 | {{optional}} | | | | |
| 5 | {{optional}} | | | | |

### Patterns (fill in only from the conversations above)

- {{Pattern seen in at least 2 conversations, with the conversation numbers}}
- {{Pattern}}
- {{Anything that argued AGAINST SettleAI's approach; keep it, judges trust a pack that shows it}}

## 3. What SettleAI changes, mapped to what we heard

| What people said | What SettleAI does | Evidence it works (from this repo) |
|---|---|---|
| {{e.g. "I deliver, then wait days for payment"}} | Money is held before work starts and released by Payouts after verified proof | Live sandbox flow in `STATUS.md`: order, capture, payout, refund ids |
| {{e.g. "I paid up front and the goods arrived damaged"}} | A dispute ends in a split and a liability finding that cites the mandate | Showcase receipt at `/receipt/showcase` |
| {{e.g. "Someone sent me an old photo as proof"}} | Duplicate-photo detection holds the payout for a person | e2e journey J2; eval scenario S03 |
| {{e.g. "I don't trust an app's word"}} | Every step is a signed receipt anyone can verify offline | `pnpm verify-receipt`, `/verify` |

## 4. One line for Devpost and the video

{{One sentence, built only from sections 1 and 2. Example shape: "In N conversations with delivery workers and shopkeepers
in CITY, X described WHAT; SettleAI pays them after verified proof, not after weeks of follow-up."}}
