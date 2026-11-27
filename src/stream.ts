import { STREAM_SEED, STREAM_SIZE } from "./config.js";
import type { SupportCase, SupportCaseKind, Transaction, WatchtowerStore } from "./types.js";

/**
 * Synthetic Black Friday transaction stream (BUILD_PLAN.md step 2).
 *
 * Seeded RNG (mulberry32) so every run is reproducible and every reported
 * figure can be traced back to its source transaction. ~80% of orders are
 * clean; the rest are planted with known ground truth — country mismatches,
 * first-order high-value, velocity bursts — recorded in a `groundTruth` map
 * that main.ts holds for the final self-check. It is NEVER handed to the
 * agents: their tools cannot see it, and the endpoint policy recomputes the
 * score from the transaction fields itself.
 *
 * Scoring (the documented rules, shared with the endpoint policy):
 * - card country differs from billing country: +40
 * - first order over €500: +30
 * - velocity >= 5 orders in the last hour: +30
 * Flag at >= 50, so a single signal alone never flags — only combinations.
 */

export interface GroundTruthLabel {
  /** True when the documented rules score this transaction >= 50. */
  suspicious: boolean;
  score: number;
  signals: string[];
}

export interface StreamResult {
  groundTruth: Map<string, GroundTruthLabel>;
  cases: SupportCase[];
}

/** mulberry32 — small deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The documented scoring rules, applied to one transaction's fields. */
export function scoreTransaction(tx: Transaction): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (tx.cardCountry !== tx.billingCountry) {
    score += 40;
    reasons.push(
      `card country ${tx.cardCountry} differs from billing country ${tx.billingCountry}`,
    );
  }
  if (tx.firstOrder && tx.amountCents > 50000) {
    score += 30;
    reasons.push(
      `first order of €${(tx.amountCents / 100).toFixed(2)} exceeds €500`,
    );
  }
  if (tx.ordersLastHour >= 5) {
    score += 30;
    reasons.push(`${tx.ordersLastHour} orders by this customer in the last hour`);
  }
  return { score, reasons };
}

const COUNTRIES = ["DE", "FR", "GB", "NL", "ES", "IT", "PL", "SE"];

type Plant = "clean" | "single-mismatch" | "single-first-high" | "single-velocity" | "mismatch-first" | "mismatch-velocity" | "first-velocity" | "all-three";

/** Plant profile per slot: 48 clean (incl. single-signal near-misses that must
 *  NOT flag) and 12 suspicious combinations that must flag. */
function plantProfile(index: number): Plant {
  // Suspicious slots, spread through the stream so flags appear over time.
  const suspicious: Record<number, Plant> = {
    4: "mismatch-first",
    9: "mismatch-velocity",
    14: "first-velocity",
    19: "all-three",
    24: "mismatch-first",
    29: "mismatch-velocity",
    34: "first-velocity",
    39: "all-three",
    44: "mismatch-first",
    49: "mismatch-velocity",
    54: "first-velocity",
    57: "all-three",
  };
  if (suspicious[index] !== undefined) return suspicious[index];
  // Single-signal near-misses: score 30–40, below the 50 flag line.
  if (index % 11 === 3) return "single-mismatch";
  if (index % 11 === 7) return "single-first-high";
  if (index % 13 === 5) return "single-velocity";
  return "clean";
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function otherCountry(rng: () => number, exclude: string): string {
  const rest = COUNTRIES.filter((c) => c !== exclude);
  return pick(rng, rest);
}

export function generateStream(store: WatchtowerStore): StreamResult {
  const rng = mulberry32(STREAM_SEED);
  const groundTruth = new Map<string, GroundTruthLabel>();
  const base = new Date("2026-11-27T06:00:00Z").getTime();

  for (let i = 0; i < STREAM_SIZE; i++) {
    const id = `tx-${String(i + 1).padStart(3, "0")}`;
    const plant = plantProfile(i);
    const billingCountry = pick(rng, COUNTRIES);
    const customerId = `cust-${String(Math.floor(rng() * 40) + 1).padStart(3, "0")}`;
    const firstOrder = rng() < 0.25;

    let cardCountry = billingCountry;
    let shippingCountry = billingCountry;
    let amountCents = 1500 + Math.floor(rng() * 16500); // €15–€180
    let ordersLastHour = Math.floor(rng() * 3); // 0–2

    switch (plant) {
      case "single-mismatch":
      case "mismatch-first":
      case "mismatch-velocity":
      case "all-three":
        cardCountry = otherCountry(rng, billingCountry);
        if (rng() < 0.5) shippingCountry = otherCountry(rng, billingCountry);
        break;
      default:
        break;
    }
    switch (plant) {
      case "single-first-high":
      case "mismatch-first":
      case "first-velocity":
      case "all-three":
        amountCents = 52000 + Math.floor(rng() * 38000); // €520–€900
        break;
      default:
        break;
    }
    // first-order rule only fires on a first order; planted first-high
    // transactions are forced to firstOrder below.
    switch (plant) {
      case "single-velocity":
      case "mismatch-velocity":
      case "first-velocity":
      case "all-three":
        ordersLastHour = 5 + Math.floor(rng() * 4); // 5–8
        break;
      default:
        break;
    }

    const tx: Transaction = {
      id,
      timestamp: new Date(base + i * 6 * 60 * 1000 + Math.floor(rng() * 120000)).toISOString(),
      customerId,
      amountCents,
      currency: "EUR",
      billingCountry,
      cardCountry,
      shippingCountry,
      itemCount: 1 + Math.floor(rng() * 4),
      firstOrder:
        plant === "single-first-high" ||
        plant === "mismatch-first" ||
        plant === "first-velocity" ||
        plant === "all-three"
          ? true
          : firstOrder,
      ordersLastHour,
    };
    store.transactions.set(id, tx);
    const { score, reasons } = scoreTransaction(tx);
    groundTruth.set(id, { suspicious: score >= 50, score, signals: reasons });
  }

  // Support cases referencing real stream transactions — some on flagged
  // ones (those must escalate), most on clean ones (those approve).
  // Suspicious txns (from the plant profile): tx-005, tx-010, tx-015, tx-020,
  // tx-025, tx-030, tx-035, tx-040, tx-045, tx-050, tx-055, tx-058.
  const caseSpecs: { kind: SupportCaseKind; transactionId: string; reason: string }[] = [
    { kind: "refund", transactionId: "tx-002", reason: "Customer received the wrong size; wants a refund." },
    { kind: "refund", transactionId: "tx-010", reason: "Customer says the order was not theirs; wants a refund." },
    { kind: "chargeback", transactionId: "tx-017", reason: "Bank opened a chargeback; customer claims non-delivery." },
    { kind: "refund", transactionId: "tx-025", reason: "Duplicate charge reported by the customer; wants a refund." },
    { kind: "chargeback", transactionId: "tx-033", reason: "Chargeback filed; customer says the item arrived damaged." },
    { kind: "refund", transactionId: "tx-058", reason: "Customer cancelled minutes after ordering; wants a refund." },
  ];
  const cases: SupportCase[] = caseSpecs.map((spec, i) => {
    const supportCase: SupportCase = {
      id: `case-${i + 1}`,
      transactionId: spec.transactionId,
      kind: spec.kind,
      reason: spec.reason,
      status: "open",
    };
    store.cases.set(supportCase.id, supportCase);
    return supportCase;
  });

  return { groundTruth, cases };
}
