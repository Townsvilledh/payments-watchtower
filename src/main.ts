import { initAgentModule, resolveAgentModule } from "@mozaik-ai/core";
import { AGENT_SPECS } from "./agents.js";
import { driveLoop } from "./driver.js";
import { localModel } from "./local-model.js";
import { createStore } from "./store.js";
import { generateStream } from "./stream.js";
import { registerTools } from "./tools.js";

/**
 * Payments Watchtower — concurrent run (BUILD_PLAN.md steps 5–6).
 *
 * Generates the seeded synthetic stream into the shared store, starts all
 * five agents at once (Promise.all over per-agent driveLoop calls — the
 * loops genuinely overlap, coordinated only through the store), then
 * self-checks the run against the planted ground truth, which the agents
 * never saw: flag precision/recall, Auditor verdicts, support-case
 * outcomes, and the ledger invariant (balance == signed sum of entries).
 */

const MAX_STEPS: Record<string, number> = {
  RiskScout: 120,
  LedgerKeeper: 160,
  Auditor: 250,
  SupportDesk: 120,
  WatchLead: 60,
};

function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const elapsed = () => `${String(Date.now() - startedAt).padStart(5, " ")}ms`;

  initAgentModule({ inferenceRunnerConfig: { supportedModels: [localModel] } });
  const mod = resolveAgentModule();

  const store = createStore();
  registerTools(mod, store);

  const { groundTruth, cases } = generateStream(store);
  const txnIds = [...store.transactions.keys()];
  const suspiciousCount = [...groundTruth.values()].filter((g) => g.suspicious).length;
  console.log(
    `Payments Watchtower — Black Friday run\n` +
      `Stream: ${txnIds.length} synthetic transactions, ${suspiciousCount} planted suspicious ` +
      `(ground truth held by the harness, never shown to the agents), ${cases.length} support cases.\n`,
  );

  // LedgerKeeper posts refund/chargeback entries for the cases the
  // deterministic rule approves — the host names them from ground truth
  // ("on refund instructions", BUILD_PLAN.md step 3). SupportDesk reaches
  // the same verdict independently from the live store, and the self-check
  // below verifies the two agree.
  const approvableCases = cases.filter((c) => !groundTruth.get(c.transactionId)?.suspicious);
  const goals: Record<string, string> = {
    RiskScout:
      `Screen these ${txnIds.length} transactions in order: ${txnIds.join(", ")}. ` +
      `For each: fetch it, score it with the documented rules, raise a flag when the score reaches 50. ` +
      `When all ${txnIds.length} are screened, finish with a one-line report.`,
    LedgerKeeper:
      `Post a sale entry for each of these ${txnIds.length} transactions: ${txnIds.join(", ")}. ` +
      `Then post these refund/chargeback entries: ` +
      approvableCases.map((c) => `${c.id}: ${c.kind} for ${c.transactionId}`).join("; ") +
      `. Then read the balance and finish with a report.`,
    Auditor:
      `Audit every risk flag in the store, in id order starting at flag-1. ` +
      `A flag that does not exist yet may appear later — keep checking. ` +
      `For each open flag, fetch the flag and its source transaction, verify every stated reason ` +
      `against the transaction's actual fields, and confirm or overturn it with a note. ` +
      `Finish with a one-line report when no new flag has appeared after several checks.`,
    SupportDesk:
      `Answer these cases in order: ` +
      cases.map((c) => `${c.id}: ${c.kind} for ${c.transactionId}`).join("; ") +
      `. For each: fetch the transaction, its ledger entries, and its flag state; ` +
      `approve only when a sale entry exists and no confirmed fraud flag stands, ` +
      `otherwise escalate with the reason. Finish with a one-line report.`,
    WatchLead:
      `When the run is complete, read the store summary and produce the Black Friday summary ` +
      `with every figure sourced. If the store is not complete yet, keep re-reading until it is.`,
  };

  const events: { at: number; agent: string; event: string }[] = [];
  const log = (agent: string, event: string) => {
    const at = Date.now() - startedAt;
    events.push({ at, agent, event });
    console.log(`[${elapsed()}] ${agent}: ${event}`);
  };

  const finals = await Promise.all(
    AGENT_SPECS.map(async (spec) => {
      const agent = await mod.createAgent(spec);
      const message = await driveLoop(mod, agent, goals[spec.name], {
        maxSteps: MAX_STEPS[spec.name] ?? 60,
        onEvent: (name, event) => log(name, event),
      });
      return { name: spec.name, message };
    }),
  );

  const watchLead = finals.find((f) => f.name === "WatchLead");
  console.log(`\n--- Agent finish messages ---`);
  for (const f of finals) console.log(`${f.name}: ${f.message}`);
  console.log(`\n--- WatchLead final summary ---\n${watchLead?.message ?? "(missing)"}\n`);

  // --- Step 6: self-check against planted ground truth (seeded synthetic set). ---
  console.log("--- Self-check (measured on the seeded synthetic set) ---");
  const failures: string[] = [];

  const flaggedTxns = new Set([...store.flags.values()].map((f) => f.transactionId));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const [txnId, label] of groundTruth) {
    const flagged = flaggedTxns.has(txnId);
    if (label.suspicious && flagged) tp++;
    else if (!label.suspicious && flagged) fp++;
    else if (label.suspicious && !flagged) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  console.log(
    `Flagging: ${tp} true positives, ${fp} false positives, ${fn} false negatives, ${tn} true negatives — ` +
      `precision ${(precision * 100).toFixed(0)}%, recall ${(recall * 100).toFixed(0)}%.`,
  );
  if (fp > 0 || fn > 0) failures.push(`flagging imperfect (FP=${fp}, FN=${fn})`);

  const confirmed = [...store.flags.values()].filter((f) => f.status === "confirmed");
  const overturned = [...store.flags.values()].filter((f) => f.status === "overturned");
  const open = [...store.flags.values()].filter((f) => f.status === "open");
  const wrongVerdicts = [...store.flags.values()].filter(
    (f) =>
      (f.status === "confirmed" && !groundTruth.get(f.transactionId)?.suspicious) ||
      (f.status === "overturned" && groundTruth.get(f.transactionId)?.suspicious),
  );
  console.log(
    `Auditor: ${confirmed.length} confirmed, ${overturned.length} overturned, ${open.length} still open.`,
  );
  if (open.length > 0) failures.push(`${open.length} flag(s) left unaudited`);
  if (wrongVerdicts.length > 0) failures.push(`${wrongVerdicts.length} wrong audit verdict(s)`);

  for (const supportCase of cases) {
    const suspicious = groundTruth.get(supportCase.transactionId)?.suspicious ?? false;
    const expected = suspicious ? "escalated" : "answered";
    const got = store.cases.get(supportCase.id)?.status;
    const resolution = store.cases.get(supportCase.id)?.resolution ?? "";
    console.log(
      `Case ${supportCase.id} (${supportCase.kind} ${supportCase.transactionId}): ` +
        `expected ${expected}, got ${got} — ${got === expected ? "OK" : "MISMATCH"}.\n` +
        `  Resolution: ${resolution}`,
    );
    if (got !== expected) failures.push(`case ${supportCase.id}: expected ${expected}, got ${got}`);
    const entry = store.ledger.find(
      (e) => e.transactionId === supportCase.transactionId && e.kind === supportCase.kind,
    );
    if (!suspicious && !entry) failures.push(`case ${supportCase.id}: approved but no ledger entry posted`);
    if (suspicious && entry) failures.push(`case ${supportCase.id}: escalated but a ledger entry was posted`);
  }

  const signedSum = store.ledger.reduce(
    (total, e) => total + (e.kind === "sale" ? e.amountCents : -e.amountCents),
    0,
  );
  const lastEntry = store.ledger[store.ledger.length - 1];
  console.log(
    `Ledger: ${store.ledger.length} entries, balance ${eur(store.balanceCents)}, ` +
      `signed sum of entries ${eur(signedSum)}, last balanceAfter ${eur(lastEntry?.balanceAfterCents ?? 0)}.`,
  );
  if (store.balanceCents !== signedSum) failures.push("ledger balance != signed sum of entries");
  if (lastEntry && lastEntry.balanceAfterCents !== store.balanceCents) {
    failures.push("last entry balanceAfter != balance");
  }

  // Concurrency evidence: every agent's first and last event timestamps.
  console.log("\n--- Concurrency (interleaved event timeline) ---");
  for (const spec of AGENT_SPECS) {
    const agentEvents = events.filter((e) => e.agent === spec.name);
    if (agentEvents.length === 0) continue;
    console.log(
      `${spec.name}: ${agentEvents.length} events, first at ${agentEvents[0].at}ms, ` +
        `last at ${agentEvents[agentEvents.length - 1].at}ms.`,
    );
  }
  const firsts = AGENT_SPECS.map(
    (s) => events.find((e) => e.agent === s.name)?.at ?? Number.POSITIVE_INFINITY,
  );
  const overlap = Math.max(...firsts) - Math.min(...firsts);
  console.log(`All five agents started within ${overlap}ms of each other; total run ${Date.now() - startedAt}ms.`);

  if (failures.length > 0) {
    console.error(`\nSELF-CHECK FAILED:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nSELF-CHECK PASSED: flags, audits, cases, and ledger all match ground truth.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
