# Build plan — event window (Thu 26 – Fri 27 Nov 2026, CET)

Rules anchor (Official Rules §4): the project must be built during the
hackathon; pre-existing frameworks, libraries and boilerplate are allowed,
but the substance happens during the event. This repo was prepared ahead of
the event as boilerplate + design only: package/config, domain types, the
shared store, agent *definitions*, the generic loop driver, and a framework
spike. Everything below is the substance, to be written inside the window.

## Timeline (all times CET; Lagos/WAT is the same clock time)

- **Before 09:00 Thu 26** — founder registration completed (see SUBMISSION.md).
- **10:00 Thu 26** — kickoff; brief confirmed against the track page.
- **Thu 26, hours 1–2** — steps 2 and 4 (stream generator, tool bodies).
- **Thu 26, hours 3–5** — step 3 (endpoint decision policy).
- **Thu 26, hour 6** — step 5 (wire main.ts, first full concurrent run).
- **Fri 27, morning** — step 6 (polish output, screenshots, README final pass).
- **Fri 27, afternoon** — step 7 (submit via the submission page; resubmit if
  fixes land — the latest entry before **24:00 CET Fri 27** is the one judged).

## Step 1 — done in scaffold (do not redo)

- `@mozaik-ai/core@5.0.1` installed; `initAgentModule` with a custom local
  model registered through `inferenceRunnerConfig.supportedModels`.
- Loop driving pattern proven in `spikes/loop-driver.ts`: setBreakpoint
  (inference) → advanceLoop → on tool_call, setBreakpoint (tool_call) →
  advanceLoop → append tool_call_result → repeat → endLoop.
- `src/driver.ts` generalises that cycle; concurrency = Promise.all over
  per-agent driveLoop calls.

## Step 2 — synthetic stream generator (`src/stream.ts`)

- Seeded RNG (mulberry32) with `STREAM_SEED`; generate `STREAM_SIZE`
  transactions over a simulated Black Friday morning.
- Distribution: ~80% clean orders; plant the rest with known ground truth —
  country mismatches, first-order high-value, velocity bursts — and record
  the planted labels in a `groundTruth` map kept OUT of the agents' reach
  (used only by the final self-check in step 6, never by agent tools).
- Also generate a handful of support cases (refund/chargeback requests)
  referencing real stream transactions, some on flagged ones.
- Feed transactions into `store.transactions`; assign work by goal strings
  when creating each agent's loop in main.ts.

## Step 3 — endpoint decision policy (`src/local-model.ts`)

Implement `LocalFinanceEndpoint.infer` as a deterministic policy keyed on
the calling agent (from the developer message / context) and the tool
results already in context:

- RiskScout: if no get_transaction result yet → call it; else score the
  transaction with the documented rules (country mismatch +40, first order
  over €500 +30, velocity ≥5/hour +30; flag at ≥50) → raise_flag or finish.
- LedgerKeeper: get_transaction → post_entry(sale) → finish; on refund
  instructions post_entry(refund/chargeback).
- Auditor: get_flag → get_transaction → recompute the flag's reasons from
  the source fields → resolve_flag confirm/overturn with a note.
- SupportDesk: get_transaction + get_ledger_entries + get_flag_for_transaction
  → answer_case (refund approved only if a sale entry exists and no
  confirmed flag stands; else escalate with reason).
- WatchLead: read_store_summary → compose the sourced summary → finish.

Return `{ type: 'inference_output', items: [...] }` exactly as in the spike.

## Step 4 — tool bodies (`src/tools.ts`)

Replace the TODO stubs with store operations:
get_transaction (Map lookup), raise_flag (create flag, id `flag-<n>`),
post_entry (append + update balanceCents + balanceAfterCents),
get_balance, get_flag, resolve_flag (set status/checkedBy/auditNote),
get_ledger_entries (filter), get_flag_for_transaction, answer_case,
read_store_summary (counts + totals + the source ids behind each figure).

## Step 5 — concurrent run (`src/main.ts`)

- Generate the stream into the store.
- Create the five agents; start driveLoop for each with its goal
  (RiskScout/LedgerKeeper process the stream; Auditor polls open flags;
  SupportDesk takes the cases; WatchLead runs last-but-concurrent, waiting
  on store state via its tool results).
- Log interleaved agent events with timestamps to prove the overlap, and
  print WatchLead's sourced summary at the end.

## Step 6 — verification and polish

- Self-check: compare Auditor outcomes and RiskScout flags against the
  planted ground truth; print precision/recall of the flagging (internal
  check output, clearly labelled as measured on the seeded synthetic set).
- Check the ledger invariant: balance == sum of entries.
- Screenshots of a run for the submission (optional but recommended).
- README: remove the scaffold-status note, confirm `npm install && npm start`
  works from a clean clone.

## Step 7 — submit

- Push final code to the public repo.
- Founder submits on the participant submission page with the prepared
  fields in SUBMISSION.md. Deadline **24:00 CET Fri 27 Nov**; resubmission
  allowed, latest counts.

## Scoring map (track page, /100)

- Useful (30): a real store problem — fraud screening + books + support in
  one run.
- Multi-agent design on Mozaik (30): five agents in parallel, shared state,
  Auditor checking RiskScout (checks between agents are named in the brief).
- It works (25): keyless, seeded, `npm start` from the README.
- Care with financial data (15): every figure sourced; synthetic only;
  "not financial advice" stated where relevant.
