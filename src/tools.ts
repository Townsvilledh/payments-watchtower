import type { AgentModule, Tool } from "@mozaik-ai/core";
import type { LedgerEntryKind, RiskFlagStatus, WatchtowerStore } from "./types.js";

/**
 * Tool implementations — the agents' hands on the shared store.
 *
 * Every body is a few lines against the store; each returns a plain object
 * (the framework JSON-stringifies it into the tool result the endpoint
 * reads back). Failures are returned as `{ ok: false, error }` values, never
 * thrown, so a bad call is visible in the agent's context instead of
 * breaking the loop.
 *
 * Invariants guarded here, not in the agents:
 * - one sale entry per transaction; one resolution per flag / case;
 * - the ledger balance always equals the signed sum of its entries
 *   (sale +, refund/chargeback −) — checked by the self-check in main.ts.
 */
const TODO_UNUSED = "";

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`tool argument "${field}" must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`tool argument "${field}" must be a finite number`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`tool argument "${field}" must be an array of strings`);
  }
  return value as string[];
}

function tool(invoke: (args: Record<string, unknown>) => unknown): Tool {
  return {
    invoke: async (args) => {
      try {
        return invoke(args);
      } catch (err) {
        return { ok: false, error: String(err instanceof Error ? err.message : err) };
      }
    },
  };
}

export const TOOL_NAMES = [
  "get_transaction",
  "raise_flag",
  "post_entry",
  "get_balance",
  "get_flag",
  "resolve_flag",
  "get_ledger_entries",
  "get_flag_for_transaction",
  "answer_case",
  "read_store_summary",
] as const;

export function registerTools(mod: AgentModule, store: WatchtowerStore): void {
  void TODO_UNUSED;

  mod.registerTool(
    "get_transaction",
    tool((args) => {
      const transactionId = asString(args.transactionId, "transactionId");
      const transaction = store.transactions.get(transactionId);
      if (!transaction) return { ok: false, error: `transaction ${transactionId} not found` };
      return { ok: true, transaction };
    }),
  );

  mod.registerTool(
    "raise_flag",
    tool((args) => {
      const transactionId = asString(args.transactionId, "transactionId");
      const reasons = asStringArray(args.reasons, "reasons");
      const score = asNumber(args.score, "score");
      if (!store.transactions.has(transactionId)) {
        return { ok: false, error: `transaction ${transactionId} not found` };
      }
      const existing = [...store.flags.values()].find((f) => f.transactionId === transactionId);
      if (existing) return { ok: false, error: `flag ${existing.id} already exists for ${transactionId}` };
      const id = `flag-${store.flags.size + 1}`;
      const flag = { id, transactionId, raisedBy: "RiskScout", reasons, score, status: "open" as RiskFlagStatus };
      store.flags.set(id, flag);
      return { ok: true, flag };
    }),
  );

  mod.registerTool(
    "post_entry",
    tool((args) => {
      const transactionId = asString(args.transactionId, "transactionId");
      const kind = asString(args.kind, "kind") as LedgerEntryKind;
      const amountCents = asNumber(args.amountCents, "amountCents");
      if (!["sale", "refund", "chargeback"].includes(kind)) {
        return { ok: false, error: `unknown ledger kind "${kind}"` };
      }
      if (!store.transactions.has(transactionId)) {
        return { ok: false, error: `transaction ${transactionId} not found` };
      }
      if (kind === "sale" && store.ledger.some((e) => e.transactionId === transactionId && e.kind === "sale")) {
        return { ok: false, error: `sale entry already exists for ${transactionId}` };
      }
      if (
        kind !== "sale" &&
        store.ledger.some((e) => e.transactionId === transactionId && e.kind === kind)
      ) {
        return { ok: false, error: `${kind} entry already exists for ${transactionId}` };
      }
      const signed = kind === "sale" ? amountCents : -amountCents;
      store.balanceCents += signed;
      const entry = {
        transactionId,
        kind,
        amountCents,
        currency: store.transactions.get(transactionId)!.currency,
        balanceAfterCents: store.balanceCents,
        recordedBy: "LedgerKeeper",
      };
      store.ledger.push(entry);
      return { ok: true, entry, balanceCents: store.balanceCents };
    }),
  );

  mod.registerTool(
    "get_balance",
    tool(() => ({ ok: true, balanceCents: store.balanceCents, entryCount: store.ledger.length })),
  );

  mod.registerTool(
    "get_flag",
    tool((args) => {
      const flagId = asString(args.flagId, "flagId");
      const flag = store.flags.get(flagId);
      if (!flag) return { ok: false, error: `flag ${flagId} not found` };
      return { ok: true, flag };
    }),
  );

  mod.registerTool(
    "resolve_flag",
    tool((args) => {
      const flagId = asString(args.flagId, "flagId");
      const verdict = asString(args.verdict, "verdict").toLowerCase();
      const note = asString(args.note, "note");
      const flag = store.flags.get(flagId);
      if (!flag) return { ok: false, error: `flag ${flagId} not found` };
      if (flag.status !== "open") {
        return { ok: false, error: `flag ${flagId} already resolved (${flag.status})` };
      }
      if (verdict !== "confirm" && verdict !== "overturn" && verdict !== "confirmed" && verdict !== "overturned") {
        return { ok: false, error: `unknown verdict "${verdict}" (want confirm or overturn)` };
      }
      flag.status = verdict.startsWith("confirm") ? "confirmed" : "overturned";
      flag.checkedBy = "Auditor";
      flag.auditNote = note;
      return { ok: true, flag };
    }),
  );

  mod.registerTool(
    "get_ledger_entries",
    tool((args) => {
      const transactionId = asString(args.transactionId, "transactionId");
      const entries = store.ledger.filter((e) => e.transactionId === transactionId);
      return { ok: true, transactionId, entries };
    }),
  );

  mod.registerTool(
    "get_flag_for_transaction",
    tool((args) => {
      const transactionId = asString(args.transactionId, "transactionId");
      const flags = [...store.flags.values()].filter((f) => f.transactionId === transactionId);
      const flag = flags.length > 0 ? flags[flags.length - 1] : null;
      return { ok: true, transactionId, flag };
    }),
  );

  mod.registerTool(
    "answer_case",
    tool((args) => {
      const caseId = asString(args.caseId, "caseId");
      const status = asString(args.status, "status");
      const resolution = asString(args.resolution, "resolution");
      const supportCase = store.cases.get(caseId);
      if (!supportCase) return { ok: false, error: `case ${caseId} not found` };
      if (supportCase.status !== "open") {
        return { ok: false, error: `case ${caseId} already ${supportCase.status}` };
      }
      if (status !== "answered" && status !== "escalated") {
        return { ok: false, error: `unknown case status "${status}" (want answered or escalated)` };
      }
      supportCase.status = status;
      supportCase.resolution = resolution;
      supportCase.handledBy = "SupportDesk";
      return { ok: true, case: supportCase };
    }),
  );

  mod.registerTool(
    "read_store_summary",
    tool(() => {
      const sales = store.ledger.filter((e) => e.kind === "sale");
      const refunds = store.ledger.filter((e) => e.kind === "refund");
      const chargebacks = store.ledger.filter((e) => e.kind === "chargeback");
      const flags = [...store.flags.values()];
      const cases = [...store.cases.values()];
      const sum = (entries: { amountCents: number }[]) =>
        entries.reduce((total, e) => total + e.amountCents, 0);
      return {
        ok: true,
        transactionsTotal: store.transactions.size,
        salesPosted: sales.length,
        grossSalesCents: sum(sales),
        refundsCents: sum(refunds),
        chargebacksCents: sum(chargebacks),
        balanceCents: store.balanceCents,
        ledgerEntries: store.ledger.length,
        flagsRaised: flags.length,
        flagsOpen: flags.filter((f) => f.status === "open").length,
        flagsConfirmed: flags.filter((f) => f.status === "confirmed").length,
        flagsOverturned: flags.filter((f) => f.status === "overturned").length,
        casesOpen: cases.filter((c) => c.status === "open").length,
        casesAnswered: cases.filter((c) => c.status === "answered").length,
        casesEscalated: cases.filter((c) => c.status === "escalated").length,
        sourceIds: {
          transactionIds: [...store.transactions.keys()],
          flagIds: flags.map((f) => f.id),
          caseIds: cases.map((c) => c.id),
        },
      };
    }),
  );
}
