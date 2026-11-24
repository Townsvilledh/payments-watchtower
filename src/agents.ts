import type { ToolDefinition } from "@mozaik-ai/core";

/**
 * The Watchtower team: five agents, one shared store, all running at once.
 *
 * - RiskScout screens every incoming order for fraud signals.
 * - LedgerKeeper posts every order (and every refund/chargeback) to the
 *   ledger and keeps the running balance.
 * - Auditor independently re-checks RiskScout's flags against the source
 *   transaction and confirms or overturns them — no flag stands on one
 *   agent's say-so.
 * - SupportDesk answers refund and chargeback cases, checking the ledger
 *   and the audit state before it replies.
 * - WatchLead closes the run with a summary in which every number cites the
 *   transaction / flag / ledger entries it came from.
 *
 * These definitions (names, instructions, tool schemas) are the prepared
 * design. The decision policy that drives them lives in the local endpoint
 * and is implemented in the event build window (BUILD_PLAN.md).
 */

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const str = { type: "string" };
const num = { type: "number" };

export interface AgentSpec {
  name: string;
  instruction: string;
  tools: ToolDefinition[];
}

const getTransaction: ToolDefinition = {
  name: "get_transaction",
  description: "Fetch one synthetic transaction by id, with all fields.",
  parameters: obj({ transactionId: str }, ["transactionId"]),
  strict: false,
};

export const AGENT_SPECS: AgentSpec[] = [
  {
    name: "RiskScout",
    instruction:
      "You are RiskScout, the fraud-screening agent for a small online store on Black Friday. " +
      "For each transaction assigned to you, inspect it and raise a risk flag when the evidence warrants: " +
      "card country differing from billing/shipping country, unusually high amount for a first order, " +
      "high order velocity, or combinations of these. Every flag must list the concrete fields that triggered it. " +
      "Do not invent signals that are not in the transaction.",
    tools: [
      getTransaction,
      {
        name: "raise_flag",
        description: "Raise a risk flag on a transaction, with reasons and a 0-100 score.",
        parameters: obj({ transactionId: str, reasons: { type: "array", items: str }, score: num }, ["transactionId", "reasons", "score"]),
        strict: false,
      },
    ],
  },
  {
    name: "LedgerKeeper",
    instruction:
      "You are LedgerKeeper. You post every settled transaction to the store ledger and keep the running " +
      "balance correct, including refunds and chargebacks when SupportDesk resolves them. You never change an " +
      "entry once posted; corrections are new entries. Your totals must always equal the sum of your entries.",
    tools: [
      getTransaction,
      {
        name: "post_entry",
        description: "Append a sale, refund, or chargeback entry to the ledger for a transaction.",
        parameters: obj({ transactionId: str, kind: str, amountCents: num }, ["transactionId", "kind", "amountCents"]),
        strict: false,
      },
      {
        name: "get_balance",
        description: "Return the current ledger balance and entry count.",
        parameters: obj({}),
        strict: false,
      },
    ],
  },
  {
    name: "Auditor",
    instruction:
      "You are Auditor, an independent checker. For each open risk flag, fetch the flag and the source " +
      "transaction and verify every stated reason against the transaction's actual fields. Confirm the flag " +
      "only if the reasons hold; overturn it if any reason is wrong or unsupported, and record why. You do not " +
      "trust RiskScout's summary — you read the source yourself.",
    tools: [
      getTransaction,
      {
        name: "get_flag",
        description: "Fetch one risk flag by id.",
        parameters: obj({ flagId: str }, ["flagId"]),
        strict: false,
      },
      {
        name: "resolve_flag",
        description: "Confirm or overturn a flag after auditing it, with an audit note.",
        parameters: obj({ flagId: str, verdict: str, note: str }, ["flagId", "verdict", "note"]),
        strict: false,
      },
    ],
  },
  {
    name: "SupportDesk",
    instruction:
      "You are SupportDesk. You answer customer refund and chargeback cases. Before answering, check the " +
      "transaction, its ledger entries, and whether an audited risk flag stands on it. Approve a refund only " +
      "when the ledger shows the payment and no confirmed fraud flag blocks it; otherwise escalate with the " +
      "reason. This system does not give financial advice; your answers are about the order only.",
    tools: [
      getTransaction,
      {
        name: "get_ledger_entries",
        description: "List ledger entries for one transaction.",
        parameters: obj({ transactionId: str }, ["transactionId"]),
        strict: false,
      },
      {
        name: "get_flag_for_transaction",
        description: "Return the audited flag state for a transaction, if any.",
        parameters: obj({ transactionId: str }, ["transactionId"]),
        strict: false,
      },
      {
        name: "answer_case",
        description: "Record the resolution of a support case (answered or escalated).",
        parameters: obj({ caseId: str, status: str, resolution: str }, ["caseId", "status", "resolution"]),
        strict: false,
      },
    ],
  },
  {
    name: "WatchLead",
    instruction:
      "You are WatchLead. At the end of the run you produce the store's Black Friday summary: orders " +
      "processed, gross and net totals, flags raised, flags confirmed and overturned, refunds issued. Every " +
      "number you report must cite the transactions, flags, or ledger entries it was counted from — a figure " +
      "without a source is not reported.",
    tools: [
      {
        name: "read_store_summary",
        description: "Read counts and totals from the shared store, with the source ids behind each figure.",
        parameters: obj({}),
        strict: false,
      },
    ],
  },
];
