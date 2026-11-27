# Payments Watchtower

A team of five AI agents, running **concurrently on [Mozaik](https://docs.jigjoy.ai)**
(`@mozaik-ai/core`), that does a small online store's Black Friday back-office
work in real time:

- **RiskScout** screens every incoming order and raises a risk flag when the
  evidence warrants — card/billing/shipping country mismatches, a large first
  order, abnormal order velocity — always citing the concrete fields that
  triggered the flag.
- **LedgerKeeper** posts every order to the ledger and keeps the running
  balance, including refunds and chargebacks. Entries are append-only; its
  totals always equal the sum of its entries.
- **Auditor** independently re-checks each of RiskScout's flags against the
  source transaction and confirms or overturns it. No flag stands on one
  agent's say-so.
- **SupportDesk** answers refund and chargeback cases, checking the ledger
  and the audited flag state before it replies, and escalating when a
  confirmed fraud flag blocks a refund.
- **WatchLead** closes the run with the store's summary — and every number in
  it cites the transactions, flags, or ledger entries it was counted from.
  A figure without a source is not reported.

Built for the **JigJoy Black Friday AI Hackathon** (26–27 November 2026),
track: *Agents in Finance*.

## Data

Synthetic only. The transaction stream is generated locally from a seeded
RNG (`STREAM_SEED` in `src/config.ts`), so runs are reproducible and judges
can trace every reported figure back to its source transaction. No real
customer data, no real accounts, no real money moves. The system does not
give financial advice.

## How it runs

The agents reason through a **local deterministic Mozaik endpoint**
(`src/local-model.ts`) registered as a model with the Mozaik module, so the
demo runs with **no API keys and no accounts**:

```bash
npm install
npm start
```

Optionally, the same agents can be pointed at a hosted model (OpenAI /
Anthropic / Gemini) by setting the matching key — see `.env.example`.

## Architecture

Mozaik v5 is host-driven: an agent's *loop* advances when the host sets the
next instruction (inference or tool call) as a breakpoint and calls
`advanceLoop`. `src/driver.ts` runs that cycle per agent, and `main.ts`
drives all five loops with `Promise.all` — the agents genuinely work at the
same time, coordinating through a shared store (`src/store.ts`) that their
tools read and write:

- RiskScout's flags are Auditor's input.
- LedgerKeeper's entries are SupportDesk's evidence.
- WatchLead reads only what the others recorded, with source ids.

Each agent is defined in `src/agents.ts` (instruction + tool schemas); the
tool bodies in `src/tools.ts` operate on the shared store; the local
endpoint's decision policy in `src/local-model.ts` reads an agent's context
and chooses its next tool call or final message.

The framework pattern itself (custom local model, breakpoint driving, tool
round-trip) is proven standalone in `spikes/loop-driver.ts`:

```bash
npm run spike
```

## Build status

Built during the hackathon event window (26–27 November 2026) per
`BUILD_PLAN.md`: the synthetic stream generator, the endpoint decision
policy, the tool bodies, and the concurrent run are all implemented and
verified. `npm run typecheck`, `npm start`, and `npm run spike` all pass
from a clean clone (`npm install && npm start`).

Verified run (27 November 2026, seeded synthetic set — full log in
`docs/run-2026-11-27.txt`): 60 transactions screened, 12 flags raised with
100% precision and 100% recall against the planted ground truth, all 12
flags confirmed by Auditor, all 6 support cases resolved as expected
(3 refunds/chargebacks approved, 3 escalated on confirmed flags), ledger
balance €14,007.81 across 63 entries equalling the signed sum of entries.
Total run time under 4 seconds; all five agents started within the same
millisecond and worked concurrently.

## Layout

```
src/
  types.ts       domain types (all synthetic data shapes)
  store.ts       shared in-memory store the agents coordinate through
  config.ts      model name, stream seed and size
  local-model.ts local deterministic Mozaik endpoint + model registration
  agents.ts      the five agent definitions (instructions, tool schemas)
  tools.ts       tool registrations against the shared store
  driver.ts      generic host driver for Mozaik loops (concurrency harness)
  main.ts        bootstrap: module, team, stream, concurrent run
spikes/
  loop-driver.ts standalone proof of the Mozaik loop pattern
```
