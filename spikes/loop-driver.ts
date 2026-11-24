/**
 * SPIKE — proof of the Mozaik v5 host-driven loop pattern.
 *
 * Written and run on 2026-11-24 against @mozaik-ai/core@5.0.1 (the version
 * npm installs today). It proves, end to end and with no API key:
 *   1. a custom local model can be registered via
 *      initAgentModule({ inferenceRunnerConfig: { supportedModels } });
 *   2. a loop advances only when the host sets an instruction breakpoint
 *      (setBreakpoint) and calls advanceLoop;
 *   3. a model tool_call is executed by the registered tool and its result
 *      fed back as a tool_call_result context item;
 *   4. the loop completes via endLoop.
 *
 * src/driver.ts generalises this exact cycle for the five-agent team.
 * Run: npm run spike
 */
import {
  initAgentModule,
  resolveAgentModule,
  type Endpoint,
  type GenerativeModel,
  type InferenceParams,
  type InferenceResult,
  type ContextItem,
} from "@mozaik-ai/core";

const localEndpoint: Endpoint = {
  async infer(params: InferenceParams): Promise<InferenceResult> {
    const hasToolResult = params.context.items.some((i) => i.type === "tool_call_result");
    if (!hasToolResult) {
      return {
        type: "inference_output",
        items: [{ type: "tool_call", requestId: "r1", toolName: "ping", toolArguments: JSON.stringify({ n: 42 }) }],
        rawResponse: null,
      };
    }
    return { type: "inference_output", items: [{ type: "model_message", text: "done after tool" }], rawResponse: null };
  },
  async *stream() {
    /* not used */
  },
};

const localModel: GenerativeModel = {
  endpoint: localEndpoint,
  specification: {
    name: "local-test",
    provider: "local",
    supportsReasoningEffort: false,
    supportedReasoningEfforts: [],
    supportsStreaming: false,
    contextWindowSize: 8192,
    supportedContextItemTypes: ["user_message", "developer_message", "model_message", "tool_call", "tool_call_result"],
    maxOutputTokens: 1024,
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
  },
};

async function main(): Promise<void> {
  initAgentModule({ inferenceRunnerConfig: { supportedModels: [localModel] } });
  const mod = resolveAgentModule();
  mod.registerTool("ping", {
    invoke: async (args) => {
      console.log("TOOL ping invoked with", args);
      return { pong: (args as { n: number }).n };
    },
  });
  const agent = await mod.createAgent({
    name: "Worker",
    instruction: "Call ping once, then finish.",
    tools: [{ name: "ping", description: "ping tool", parameters: { type: "object", properties: { n: { type: "number" } } }, strict: false }],
  });
  const loop = await mod.createLoop({ agentId: agent.id, goal: "ping then finish" });

  const context: ContextItem[] = [
    { type: "developer_message", text: agent.instruction },
    { type: "user_message", text: loop.goal },
  ];

  for (let step = 0; step < 8; step++) {
    await mod.setBreakpoint({
      loopId: loop.id,
      instruction: { type: "inference", parameters: { model: "local-test", context: { items: [...context] }, tools: agent.tools } },
    });
    await mod.advanceLoop({ loopId: loop.id });
    let rec = await mod.getLoop(loop.id);
    const last = rec.completedInstructions[rec.completedInstructions.length - 1];
    if (last?.type !== "inference" || last.result?.type !== "inference_output") throw new Error("unexpected inference record");
    context.push(...last.result.items);
    const call = last.result.items.find((i) => i.type === "tool_call");
    if (!call) {
      await mod.endLoop({ loopId: loop.id, message: "finished" });
      break;
    }
    await mod.setBreakpoint({
      loopId: loop.id,
      instruction: { type: "tool_call", parameters: { toolName: call.toolName, toolArguments: call.toolArguments } },
    });
    await mod.advanceLoop({ loopId: loop.id });
    rec = await mod.getLoop(loop.id);
    const tc = rec.completedInstructions[rec.completedInstructions.length - 1];
    if (tc?.type !== "tool_call" || !tc.result) throw new Error("unexpected tool record");
    context.push({ type: "tool_call_result", requestId: call.requestId, result: { type: "input_text", text: tc.result.result } });
  }
  const final = await mod.getLoop(loop.id);
  console.log("final loop state:", final.state, "| message:", final.message);
}

main().catch((e) => {
  console.error("SPIKE FAIL", e);
  process.exit(1);
});
