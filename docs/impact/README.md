# Impact evidence pack

Purpose: show judges, briefly and honestly, that the problem is real for the people SettleAI is for first: **small
businesses that outsource deliveries and repairs**, and the workers they pay, who are often paid late or not at all.

Rules for this pack:

- **No invented numbers or quotes.** Every statistic below carries its source and the date it was checked.
- **No user interviews are claimed.** We did not run a structured interview study before submission, so this pack quotes
  no one.

## 1. The problem, in published numbers

| Claim | Figure | Source | Checked |
|---|---|---|---|
| Late or unpaid work (New York freelancers) | Nearly three in four had faced nonpayment or late payment (the release gives both 74% and 73%, so we say "nearly three in four") | NYC Mayor's Office of Media and Entertainment, Freelancers Union and Upwork, *Freelancing in New York 2019* ([PDF](https://www.nyc.gov/assets/mome/pdf/freelancing-ny-report-09062019.pdf), [release](https://www.nyc.gov/site/mome/news/09102019-freelancing-in-ny-report.page)) | 9 Nov 2026 |
| Freelancers who struggle to get paid (US) | 1 in 2 had trouble getting paid in a year | Freelancers Union nonpayment survey ([report PDF](https://onlabor.org/wp-content/uploads/2017/05/FU_NonpaymentReport_r3.pdf)) | 7 Nov 2026 |
| Small-business late payment (UK) | 62.6% of invoices sent in the past year were paid late | FreeAgent survey, reported by [Financial IT](https://financialit.net/news/cash-management/sme-cash-flow-crisis-nearly-two-thirds-invoices-paid-late-across-uk) | 7 Nov 2026 |
| Agentic commerce outlook | Up to $1 trillion of US retail revenue orchestrated by AI agents by 2030; $3–5 trillion globally | McKinsey, [*The agentic commerce opportunity*](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants) (Oct 2025) | 7 Nov 2026 |
| Size of India's gig workforce | 7.7 million in 2020-21, projected 23.5 million by 2029-30 | NITI Aayog, *India's Booming Gig and Platform Economy* (June 2022); [PIB release](https://pib.gov.in/PressReleasePage.aspx?PRID=1837277) | 7 Nov 2026 |

The US and UK figures are context, not India figures. No India-specific primary source on late payment was found, so none
is quoted.

## 2. What SettleAI changes

| Problem | What SettleAI does | Evidence it works (from this repo) |
|---|---|---|
| Workers deliver, then wait for payment | Money is held by PayPal for the job before work starts and paid out by Payouts after verified proof | Live sandbox flow in `STATUS.md`: order, capture, payout and refund ids |
| Payers pay up front and the work is bad or missing | A dispute ends in a split and a liability finding that cites the mandate | Showcase receipt at `/receipt/showcase` |
| Old or reused photos sent as proof | Duplicate-photo detection holds the payout for a person | e2e journey J2; eval scenario S03 |
| "Why should I trust the app's word?" | Every step is a signed receipt anyone can verify offline | `pnpm verify-receipt`, `/verify` |
| An AI agent overspends or hires out of scope | The Mandate Guard denies it before any money moves | e2e journey J6; eval mandate scenarios |

## 3. One line for Devpost and the video

Nearly three in four New York freelancers have been paid late or not at all, and AI agents are about to start hiring;
SettleAI pays workers after verified proof and says who is liable when the work was not done.
