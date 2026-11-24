import type { AgentModule, Tool } from "@mozaik-ai/core";
import type { WatchtowerStore } from "./types.js";

/**
 * Tool implementations — the agents' hands on the shared store.
 *
 * SCAFFOLD STATE: every tool the agents declare (see src/agents.ts) is
 * registered here so the module wiring is complete and typechecks, but the
 * bodies are implemented during the hackathon build window
 * (BUILD_PLAN.md step 4). Each body is a few lines against the store —
 * e.g. get_transaction is a Map lookup that serialises the transaction.
 */
const TODO = (name: string): Tool => ({
  invoke: async () => {
    throw new Error(`tool "${name}": implemented during the hackathon build window (BUILD_PLAN.md step 4)`);
  },
});

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

export function registerTools(mod: AgentModule, _store: WatchtowerStore): void {
  for (const name of TOOL_NAMES) {
    mod.registerTool(name, TODO(name));
  }
}
