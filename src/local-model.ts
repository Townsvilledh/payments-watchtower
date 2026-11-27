import {
  type Endpoint,
  type GenerativeModel,
  type InferenceParams,
  type InferenceResult,
  type ModelOutputItem,
} from "@mozaik-ai/core";
import { LOCAL_MODEL_NAME } from "./config.js";
import { scoreTransaction } from "./stream.js";
import type { Transaction } from "./types.js";

/**
 * The local deterministic endpoint the Watchtower agents reason through
 * (BUILD_PLAN.md step 3).
 *
 * Mozaik picks a model by name from the models registered in
 * `initAgentModule({ inferenceRunnerConfig: { supportedModels } })`, so
 * registering this model makes every agent runnable with no API key. The
 * endpoint inspects the agent's context (its instruction, the goal, and the
 * tool results so far) and decides the next step: call a tool, or finish
 * with a message.
 *
 * The policy is deterministic and stateless across calls: everything it
 * needs is derived from the context items the driver accumulates (tool
 * calls and their results). Each agent's policy is a small state machine
 * over its own call history:
 *
 * - RiskScout: walk its transaction list; fetch each, score it with the
 *   documented rules (mismatch +40, first order over €500 +30, velocity
 *   >=5/hour +30), raise a flag at >= 50, otherwise move on.
 * - LedgerKeeper: post a sale entry per transaction, then the
 *   refund/chargeback entries named in its goal, then read the balance.
 * - Auditor: poll flag-1, flag-2, … in order (a flag that does not exist
 *   yet may appear later — retry with a short pause); for each open flag
 *   fetch the source transaction, recompute the reasons from its fields,
 *   and confirm or overturn with a note.
 * - SupportDesk: per case, fetch the transaction, its ledger entries, and
 *   its flag state (re-checking while the other agents are still working);
 *   approve only when a sale entry exists and no confirmed flag stands,
 *   otherwise escalate with the reason.
 * - WatchLead: re-read the store summary until the run is complete
 *   (all sales posted, no open flags, no open cases), then compose the
 *   sourced summary as its final message.
 *
 * A decision that needs no tool call leaves no trace in context, so every
 * policy is written so progress is always visible as a tool call or a
 * finished message — nothing is decided silently and then re-decided.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let requestCounter = 0;
function toolCall(toolName: string, args: Record<string, unknown>): ModelOutputItem {
  return {
    type: "tool_call",
    requestId: `req-${++requestCounter}`,
    toolName,
    toolArguments: JSON.stringify(args),
  };
}
function finish(text: string): ModelOutputItem {
  return { type: "model_message", text };
}
function output(items: ModelOutputItem[]): InferenceResult {
  return { type: "inference_output", items, rawResponse: null };
}

interface CallRecord {
  name: string;
  args: Record<string, unknown>;
  resultText: string;
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseContext(params: InferenceParams): {
  agent: string;
  goal: string;
  calls: CallRecord[];
} {
  let agent = "";
  let goal = "";
  const resultsByRequest = new Map<string, string>();
  const callItems: { requestId: string; toolName: string; toolArguments: string }[] = [];

  for (const item of params.context.items) {
    if (item.type === "developer_message" && !agent) {
      const match = /\b(RiskScout|LedgerKeeper|Auditor|SupportDesk|WatchLead)\b/.exec(item.text);
      if (match) agent = match[1];
    }
    if (item.type === "user_message" && !goal) goal = item.text;
    if (item.type === "tool_call") {
      callItems.push({
        requestId: item.requestId,
        toolName: item.toolName,
        toolArguments: item.toolArguments,
      });
    }
    if (item.type === "tool_call_result") {
      resultsByRequest.set(item.requestId, item.result.text);
    }
  }

  const calls: CallRecord[] = callItems.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.toolArguments);
      if (isRecord(parsed)) args = parsed;
    } catch {
      args = {};
    }
    const resultText = resultsByRequest.get(call.requestId) ?? "";
    let result: unknown = null;
    try {
      result = resultText ? JSON.parse(resultText) : null;
    } catch {
      result = { ok: false, error: resultText };
    }
    return { name: call.toolName, args, resultText, result };
  });

  return { agent, goal, calls };
}

function extractIds(goal: string, pattern: RegExp): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of goal.matchAll(pattern)) {
    const id = match[0];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

interface CaseAssignment {
  id: string;
  kind: string;
  transactionId: string;
}

function extractCases(goal: string): CaseAssignment[] {
  const cases: CaseAssignment[] = [];
  for (const match of goal.matchAll(/case-(\d+):\s*(refund|chargeback) for (tx-\d+)/g)) {
    cases.push({ id: `case-${match[1]}`, kind: match[2], transactionId: match[3] });
  }
  return cases;
}

function callsFor(calls: CallRecord[], name: string): CallRecord[] {
  return calls.filter((c) => c.name === name);
}

function resultOk(call: CallRecord | undefined): boolean {
  return !!call && isRecord(call.result) && call.result.ok === true;
}

function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** RiskScout: screen each assigned transaction, flag at score >= 50. */
function riskScoutPolicy(goal: string, calls: CallRecord[]): ModelOutputItem[] {
  const txnIds = extractIds(goal, /tx-\d+/g);
  const flagsRaised: { flagId: string; transactionId: string; score: number }[] = [];
  for (const call of callsFor(calls, "raise_flag")) {
    if (resultOk(call) && isRecord(call.result) && isRecord(call.result.flag)) {
      const flag = call.result.flag as Record<string, unknown>;
      flagsRaised.push({
        flagId: String(flag.id),
        transactionId: String(call.args.transactionId),
        score: Number(call.args.score),
      });
    }
  }

  for (const txnId of txnIds) {
    if (
      flagsRaised.some((f) => f.transactionId === txnId) ||
      callsFor(calls, "raise_flag").some((c) => c.args.transactionId === txnId)
    ) {
      continue; // already flagged (a second raise would only repeat the tool's guard error)
    }
    const fetched = [...callsFor(calls, "get_transaction")]
      .reverse()
      .find((c) => c.args.transactionId === txnId && resultOk(c));
    if (!fetched) {
      // Never fetched, or the fetch failed: (re)fetch it.
      const attempted = callsFor(calls, "get_transaction").some((c) => c.args.transactionId === txnId);
      if (!attempted) return [toolCall("get_transaction", { transactionId: txnId })];
      continue; // fetch errored — skip rather than loop forever.
    }
    const tx = (fetched.result as Record<string, unknown>).transaction as Transaction;
    const { score, reasons } = scoreTransaction(tx);
    if (score >= 50) return [toolCall("raise_flag", { transactionId: txnId, reasons, score })];
    // Clean: no flag, move on to the next transaction.
  }

  const summary =
    flagsRaised.length === 0
      ? `Screened ${txnIds.length} transactions; no flags raised.`
      : `Screened ${txnIds.length} transactions; raised ${flagsRaised.length} flags: ` +
        flagsRaised.map((f) => `${f.flagId} (${f.transactionId}, score ${f.score})`).join(", ") +
        ".";
  return [finish(summary)];
}

/** LedgerKeeper: sales, then the named refund/chargeback entries, then balance. */
function ledgerKeeperPolicy(goal: string, calls: CallRecord[]): ModelOutputItem[] {
  const txnIds = extractIds(goal, /tx-\d+/g);
  const cases = extractCases(goal);

  const postedSales = new Set<string>();
  const postedAdjustments = new Set<string>();
  for (const call of callsFor(calls, "post_entry")) {
    if (resultOk(call)) {
      if (call.args.kind === "sale") postedSales.add(String(call.args.transactionId));
      else postedAdjustments.add(`${call.args.kind}:${call.args.transactionId}`);
    } else if (
      isRecord(call.result) &&
      typeof call.result.error === "string" &&
      call.result.error.includes("already exists")
    ) {
      // Idempotency guard in the tool: the entry is already there.
      if (call.args.kind === "sale") postedSales.add(String(call.args.transactionId));
      else postedAdjustments.add(`${call.args.kind}:${call.args.transactionId}`);
    }
  }

  for (const txnId of txnIds) {
    if (postedSales.has(txnId)) continue;
    const fetched = [...callsFor(calls, "get_transaction")]
      .reverse()
      .find((c) => c.args.transactionId === txnId && resultOk(c));
    if (!fetched) {
      const attempted = callsFor(calls, "get_transaction").some((c) => c.args.transactionId === txnId);
      if (!attempted) return [toolCall("get_transaction", { transactionId: txnId })];
      continue;
    }
    const tx = (fetched.result as Record<string, unknown>).transaction as Transaction;
    return [toolCall("post_entry", { transactionId: txnId, kind: "sale", amountCents: tx.amountCents })];
  }

  for (const supportCase of cases) {
    const key = `${supportCase.kind}:${supportCase.transactionId}`;
    if (postedAdjustments.has(key)) continue;
    const fetched = [...callsFor(calls, "get_transaction")]
      .reverse()
      .find((c) => c.args.transactionId === supportCase.transactionId && resultOk(c));
    if (!fetched) {
      const attempted = callsFor(calls, "get_transaction").some(
        (c) => c.args.transactionId === supportCase.transactionId,
      );
      if (!attempted) return [toolCall("get_transaction", { transactionId: supportCase.transactionId })];
      continue; // transaction unreadable — no entry can be priced; skip it.
    }
    const tx = (fetched.result as Record<string, unknown>).transaction as Transaction;
    return [
      toolCall("post_entry", {
        transactionId: supportCase.transactionId,
        kind: supportCase.kind,
        amountCents: tx.amountCents,
      }),
    ];
  }

  const balanceCall = [...callsFor(calls, "get_balance")].reverse().find((c) => resultOk(c));
  if (!balanceCall) return [toolCall("get_balance", {})];
  const balance = (balanceCall.result as Record<string, unknown>).balanceCents as number;
  const entries = (balanceCall.result as Record<string, unknown>).entryCount as number;
  return [
    finish(
      `Posted ${postedSales.size} sale entries and ${postedAdjustments.size} refund/chargeback entries; ` +
        `ledger balance ${eur(balance)} across ${entries} entries.`,
    ),
  ];
}

/** Auditor: poll flags in id order, verify each against its source transaction. */
async function auditorPolicy(calls: CallRecord[]): Promise<ModelOutputItem[]> {
  const resolved = new Map<string, { verdict: string; note: string }>();
  for (const call of callsFor(calls, "resolve_flag")) {
    if (resultOk(call)) {
      resolved.set(String(call.args.flagId), {
        verdict: String(call.args.verdict),
        note: String(call.args.note),
      });
    }
  }
  const confirmed = [...resolved.values()].filter((r) => r.verdict.startsWith("confirm")).length;
  const overturned = resolved.size - confirmed;

  let n = 1;
  for (;;) {
    const flagId = `flag-${n}`;
    if (resolved.has(flagId)) {
      n++;
      continue;
    }
    const flagCalls = callsFor(calls, "get_flag").filter((c) => c.args.flagId === flagId);
    const lastFlagCall = flagCalls[flagCalls.length - 1];
    if (!lastFlagCall || !resultOk(lastFlagCall)) {
      const misses = flagCalls.length;
      if (misses >= 15) {
        return [
          finish(
            `Audited ${resolved.size} flags: ${confirmed} confirmed, ${overturned} overturned; ` +
              `no further flag appeared after 15 checks.`,
          ),
        ];
      }
      if (misses > 0) await sleep(250);
      return [toolCall("get_flag", { flagId })];
    }
    const flag = (lastFlagCall.result as Record<string, unknown>).flag as Record<string, unknown>;
    if (flag.status !== "open") {
      // Already resolved outside this loop's own calls — move on.
      n++;
      continue;
    }
    const txnId = String(flag.transactionId);
    const fetched = [...callsFor(calls, "get_transaction")]
      .reverse()
      .find((c) => c.args.transactionId === txnId && resultOk(c));
    if (!fetched) {
      const attempted = callsFor(calls, "get_transaction").some((c) => c.args.transactionId === txnId);
      if (!attempted) return [toolCall("get_transaction", { transactionId: txnId })];
      return [
        toolCall("resolve_flag", {
          flagId,
          verdict: "overturn",
          note: `Source transaction ${txnId} could not be read, so the flag cannot be verified — overturned.`,
        }),
      ];
    }
    const tx = (fetched.result as Record<string, unknown>).transaction as Transaction;
    const { score, reasons } = scoreTransaction(tx);
    const stated = Array.isArray(flag.reasons) ? (flag.reasons as string[]) : [];
    const reasonsHold = stated.every((r) => reasons.includes(r)) && score >= 50;
    if (reasonsHold) {
      return [
        toolCall("resolve_flag", {
          flagId,
          verdict: "confirm",
          note:
            `Recomputed score ${score} from the source transaction: ` +
            reasons.join("; ") +
            `. Every stated reason holds.`,
        }),
      ];
    }
    return [
      toolCall("resolve_flag", {
        flagId,
        verdict: "overturn",
        note:
          `Recomputed score ${score} from the source transaction: ` +
          (reasons.length > 0 ? reasons.join("; ") : "no rule fires") +
          `. Stated reasons (${stated.join("; ") || "none"}) do not hold.`,
      }),
    ];
  }
}

/** SupportDesk: one case at a time — ledger, then flag state, then answer. */
async function supportDeskPolicy(goal: string, calls: CallRecord[]): Promise<ModelOutputItem[]> {
  const cases = extractCases(goal);
  const answered = new Set<string>();
  for (const call of callsFor(calls, "answer_case")) {
    if (resultOk(call)) answered.add(String(call.args.caseId));
    else if (
      isRecord(call.result) &&
      typeof call.result.error === "string" &&
      call.result.error.includes("already")
    ) {
      answered.add(String(call.args.caseId));
    }
  }

  for (const supportCase of cases) {
    if (answered.has(supportCase.id)) continue;
    const txnId = supportCase.transactionId;

    const fetched = [...callsFor(calls, "get_transaction")]
      .reverse()
      .find((c) => c.args.transactionId === txnId && resultOk(c));
    if (!fetched) {
      const attempted = callsFor(calls, "get_transaction").some((c) => c.args.transactionId === txnId);
      if (!attempted) return [toolCall("get_transaction", { transactionId: txnId })];
      return [
        toolCall("answer_case", {
          caseId: supportCase.id,
          status: "escalated",
          resolution: `Escalated: transaction ${txnId} could not be read, so the ${supportCase.kind} cannot be decided.`,
        }),
      ];
    }
    const tx = (fetched.result as Record<string, unknown>).transaction as Transaction;

    const ledgerCalls = callsFor(calls, "get_ledger_entries").filter((c) => c.args.transactionId === txnId);
    const lastLedger = ledgerCalls[ledgerCalls.length - 1];
    const saleExists =
      !!lastLedger &&
      resultOk(lastLedger) &&
      isRecord(lastLedger.result) &&
      Array.isArray(lastLedger.result.entries) &&
      (lastLedger.result.entries as { kind: string }[]).some((e) => e.kind === "sale");
    if (!saleExists) {
      if (ledgerCalls.length < 10) {
        if (ledgerCalls.length > 0) await sleep(200);
        return [toolCall("get_ledger_entries", { transactionId: txnId })];
      }
      return [
        toolCall("answer_case", {
          caseId: supportCase.id,
          status: "escalated",
          resolution: `Escalated: no sale entry for ${txnId} on the ledger after repeated checks, so no ${supportCase.kind} can be issued.`,
        }),
      ];
    }

    const flagCalls = callsFor(calls, "get_flag_for_transaction").filter(
      (c) => c.args.transactionId === txnId,
    );
    const lastFlag = flagCalls[flagCalls.length - 1];
    const flagState =
      lastFlag && resultOk(lastFlag) && isRecord(lastFlag.result)
        ? (lastFlag.result.flag as Record<string, unknown> | null)
        : undefined;
    if (flagState === undefined) {
      return [toolCall("get_flag_for_transaction", { transactionId: txnId })];
    }
    if (flagState && flagState.status === "open") {
      if (flagCalls.length < 10) {
        await sleep(200);
        return [toolCall("get_flag_for_transaction", { transactionId: txnId })];
      }
      return [
        toolCall("answer_case", {
          caseId: supportCase.id,
          status: "escalated",
          resolution: `Escalated: risk flag ${String(flagState.id)} on ${txnId} is still under audit, so the ${supportCase.kind} cannot be decided yet.`,
        }),
      ];
    }
    if (flagState && flagState.status === "confirmed") {
      return [
        toolCall("answer_case", {
          caseId: supportCase.id,
          status: "escalated",
          resolution:
            `Escalated: confirmed fraud flag ${String(flagState.id)} stands on ${txnId} ` +
            `(${Array.isArray(flagState.reasons) ? (flagState.reasons as string[]).join("; ") : ""}), ` +
            `so the ${supportCase.kind} is blocked pending review.`,
        }),
      ];
    }
    return [
      toolCall("answer_case", {
        caseId: supportCase.id,
        status: "answered",
        resolution:
          `${supportCase.kind === "refund" ? "Refund" : "Chargeback"} of ${eur(tx.amountCents)} approved for ${txnId}: ` +
          `sale entry is on the ledger and no confirmed fraud flag stands.`,
      }),
    ];
  }

  return [finish(`Answered ${cases.length} support cases: ${answered.size} resolved.`)]
}

/** WatchLead: wait for the run to complete, then report the sourced summary. */
async function watchLeadPolicy(calls: CallRecord[]): Promise<ModelOutputItem[]> {
  const summaryCalls = callsFor(calls, "read_store_summary").filter((c) => resultOk(c));
  const latest = summaryCalls[summaryCalls.length - 1];
  if (!latest) return [toolCall("read_store_summary", {})];
  const s = latest.result as Record<string, unknown>;
  const complete =
    (s.salesPosted as number) >= (s.transactionsTotal as number) &&
    (s.flagsOpen as number) === 0 &&
    (s.casesOpen as number) === 0;
  if (!complete && summaryCalls.length < 40) {
    await sleep(250);
    return [toolCall("read_store_summary", {})];
  }
  const sourceIds = s.sourceIds as Record<string, string[]>;
  const summary =
    `Black Friday watch summary (synthetic data, not financial advice): ` +
    `${s.salesPosted} of ${s.transactionsTotal} orders posted to the ledger; ` +
    `gross sales ${eur(s.grossSalesCents as number)}; refunds ${eur(s.refundsCents as number)}; ` +
    `chargebacks ${eur(s.chargebacksCents as number)}; ledger balance ${eur(s.balanceCents as number)} ` +
    `across ${s.ledgerEntries} entries. ` +
    `Risk: ${s.flagsRaised} flags raised (${sourceIds.flagIds.join(", ") || "none"}), ` +
    `${s.flagsConfirmed} confirmed, ${s.flagsOverturned} overturned. ` +
    `Support: ${s.casesAnswered} cases answered, ${s.casesEscalated} escalated (${sourceIds.caseIds.join(", ")}). ` +
    `Every figure traces to the transactions, flags, and ledger entries above.`;
  return [finish(summary)];
}

export class LocalFinanceEndpoint implements Endpoint {
  async infer(params: InferenceParams): Promise<InferenceResult> {
    const { agent, goal, calls } = parseContext(params);
    switch (agent) {
      case "RiskScout":
        return output(riskScoutPolicy(goal, calls));
      case "LedgerKeeper":
        return output(ledgerKeeperPolicy(goal, calls));
      case "Auditor":
        return output(await auditorPolicy(calls));
      case "SupportDesk":
        return output(await supportDeskPolicy(goal, calls));
      case "WatchLead":
        return output(await watchLeadPolicy(calls));
      default:
        return output([
          finish(
            "No work assigned: the calling agent could not be identified from the context.",
          ),
        ]);
    }
  }

  async *stream(_params: InferenceParams): AsyncIterable<never> {
    throw new Error("LocalFinanceEndpoint.stream: not used by the Watchtower driver.");
  }
}

export const localModel: GenerativeModel = {
  endpoint: new LocalFinanceEndpoint(),
  specification: {
    name: LOCAL_MODEL_NAME,
    provider: "local",
    supportsReasoningEffort: false,
    supportedReasoningEfforts: [],
    supportsStreaming: false,
    contextWindowSize: 32768,
    supportedContextItemTypes: [
      "user_message",
      "system_message",
      "developer_message",
      "model_message",
      "tool_call",
      "tool_call_result",
    ],
    maxOutputTokens: 2048,
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
  },
};
