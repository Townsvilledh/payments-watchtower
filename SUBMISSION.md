# Registration & submission pack — founder steps

Two steps in this entry belong to the founder personally, because both sit
behind his own registration identity. Everything else is prepared.

## Step A — Register (before 09:00 CET, Thu 26 Nov 2026)

1. Go to https://build.jigjoy.ai and register for the Black Friday AI
   Hackathon (registration is free; it closes 09:00 CET on Thu 26 Nov).
2. Choose: **Online** participation, **Solo** entry.
3. Registration gives access to the participant dashboard, the Discord, and
   the submission page (per Rules §1, links and updates are announced on the
   dashboard, in Discord, and by email).
4. No KYC or identity verification is required at registration or entry
   (Rules §§2–5). Name and email are collected as participant data
   (Rules §12).

## Step B — Submit (before 24:00 CET, Fri 27 Nov 2026)

On the submission page (Rules §5), paste:

- **Project name:** Payments Watchtower
- **Repository:** https://github.com/Townsvilledh/payments-watchtower
- **Description:**
  A five-agent Mozaik team that runs a small store's Black Friday back
  office on synthetic data. RiskScout screens every incoming order and
  flags suspicious ones with the concrete fields that triggered each flag.
  LedgerKeeper posts every order, refund, and chargeback to an append-only
  ledger and keeps the balance. Auditor independently re-checks each flag
  against the source transaction and confirms or overturns it. SupportDesk
  answers refund and chargeback cases only after checking the ledger and
  the audited flag state. WatchLead closes with a summary in which every
  number cites the transactions, flags, or ledger entries it came from.
  The agents run keyless on a local deterministic Mozaik endpoint, so the
  demo runs from the README with no accounts: npm install && npm start.
- **How the agents run concurrently:**
  Mozaik v5 loops are host-driven: each agent has its own loop, and the
  host advances all five loops at the same time (Promise.all over
  per-agent drivers that cycle setBreakpoint → advanceLoop). The agents
  coordinate through a shared store their tools read and write — RiskScout's
  flags are Auditor's input, LedgerKeeper's entries are SupportDesk's
  evidence — so screening, bookkeeping, auditing, and support proceed in
  parallel and react to each other's work as it lands, rather than running
  as a fixed sequence.
- **Demo video / live deployment / screenshots:** optional per Rules §5
  ("optional but strongly recommended"); the track page states no video is
  needed. Attach run screenshots from the repo if the form offers uploads.

Resubmission is allowed until the deadline; the latest entry is judged
(Rules §1).

## If it wins — payout facts (Rules §§7–8)

- Prizes: 1st $500, 2nd $300, 3rd $200, announced 4 Dec 2026 in Discord and
  by email. Judging may take up to 7 days after submissions close,
  extendable by 7 more (Rules §6).
- Cash is paid **through Upwork**: the winner needs an Upwork account able
  to receive payments and must provide the information Upwork/JigJoy
  reasonably require (Rules §8). JigJoy initiates payment within 7 days of
  the winner announcement — so by ~11 Dec 2026, plus Upwork's own
  processing/withdrawal time.
- Founder action needed at that stage: create/verify an Upwork account in
  his own name (Upwork identity verification is a payout-stage step; none
  is required to enter or submit).
