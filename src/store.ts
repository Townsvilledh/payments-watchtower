import type { WatchtowerStore } from "./types.js";

/** In-memory shared store. Infrastructure only — no finance decisions live
 *  here; agents make decisions, this just holds what they share. */
export function createStore(): WatchtowerStore {
  return {
    transactions: new Map(),
    flags: new Map(),
    ledger: [],
    cases: new Map(),
    balanceCents: 0,
  };
}
