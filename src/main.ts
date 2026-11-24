import { initAgentModule, resolveAgentModule } from "@mozaik-ai/core";
import { AGENT_SPECS } from "./agents.js";
import { localModel } from "./local-model.js";
import { createStore } from "./store.js";
import { registerTools } from "./tools.js";

/**
 * Payments Watchtower — bootstrap.
 *
 * Wires the Mozaik module with the local keyless model, registers the tools
 * on the shared store, and creates the five-agent team with a loop each.
 *
 * SCAFFOLD STATE: the synthetic transaction stream and the concurrent loop
 * driving (src/driver.ts, Promise.all over the team) are switched on in the
 * hackathon build window — see BUILD_PLAN.md steps 2–5. This bootstrap is
 * what that build extends; it runs today to prove the wiring.
 */
async function main(): Promise<void> {
  initAgentModule({ inferenceRunnerConfig: { supportedModels: [localModel] } });
  const mod = resolveAgentModule();

  const store = createStore();
  registerTools(mod, store);

  console.log("Payments Watchtower — Mozaik team");
  for (const spec of AGENT_SPECS) {
    const agent = await mod.createAgent(spec);
    const loop = await mod.createLoop({
      agentId: agent.id,
      goal: "Stand by for the Black Friday transaction stream.",
    });
    console.log(
      `- ${spec.name}: agent ${agent.id.slice(0, 8)}…, loop ${loop.id.slice(0, 8)}… (${loop.state}), tools: ${spec.tools.map((t) => t.name).join(", ")}`,
    );
  }
  console.log(
    "\nWiring OK. The stream generator and concurrent driving are enabled in the event build (BUILD_PLAN.md).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
