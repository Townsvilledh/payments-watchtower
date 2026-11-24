/**
 * Domain types for Payments Watchtower.
 *
 * All data in this project is SYNTHETIC (generated locally from a seeded RNG)
 * or public. No real customer data, no real accounts, no real money moves —
 * per the hackathon track ground rules.
 */

export interface Transaction {
  id: string;
  /** ISO timestamp when the synthetic order was placed. */
  timestamp: string;
  customerId: string;
  amountCents: number;
  currency: string;
  /** Country the customer claims to be in. */
  billingCountry: string;
  /** Country the payment card was issued in. */
  cardCountry: string;
  /** Shipping country, when different from billing. */
  shippingCountry: string;
  itemCount: number;
  /** True when this is the customer's first ever order (synthetic history). */
  firstOrder: boolean;
  /** Orders by this customer in the previous hour (synthetic velocity). */
  ordersLastHour: number;
}

export type RiskFlagStatus = "open" | "confirmed" | "overturned";

export interface RiskFlag {
  id: string;
  transactionId: string;
  raisedBy: string;
  /** Human-readable reasons, each pointing at the transaction fields used. */
  reasons: string[];
  score: number;
  status: RiskFlagStatus;
  /** Agent that audited the flag, once checked. */
  checkedBy?: string;
  auditNote?: string;
}

export type LedgerEntryKind = "sale" | "refund" | "chargeback";

export interface LedgerEntry {
  transactionId: string;
  kind: LedgerEntryKind;
  amountCents: number;
  currency: string;
  /** Running balance after this entry, in cents. Every figure in the final
   *  report must be traceable to entries listed here. */
  balanceAfterCents: number;
  recordedBy: string;
}

export type SupportCaseKind = "refund" | "chargeback";
export type SupportCaseStatus = "open" | "answered" | "escalated";

export interface SupportCase {
  id: string;
  transactionId: string;
  kind: SupportCaseKind;
  reason: string;
  status: SupportCaseStatus;
  resolution?: string;
  handledBy?: string;
}

/** Shared state every agent's tools read and write. Shared state is what makes
 *  the agents a team rather than five separate scripts: RiskScout's flags are
 *  Auditor's input, LedgerKeeper's entries are SupportDesk's evidence. */
export interface WatchtowerStore {
  transactions: Map<string, Transaction>;
  flags: Map<string, RiskFlag>;
  ledger: LedgerEntry[];
  cases: Map<string, SupportCase>;
  balanceCents: number;
}
