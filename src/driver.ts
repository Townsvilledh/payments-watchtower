import {
  type Agent,
  type AgentModule,
  type ContextItem,
} from "@mozaik-ai/core";
import { LOCAL_MODEL_NAME } from "./config.js";

/**
 * Generic host driver for Mozaik v5 loops.
 *
 * Mozaik's runtime is host-driven: a loop only advances when the host sets
 * the next instruction as a breakpoint and calls advanceLoop. This driver
 * runs the standard cycle — inference → (tool call → tool result)* → final
 * message — while keeping the agent's context in step. It is framework
 * harness, proven end-to-end in spikes/loop-driver.ts; the finance behaviour
 * lives in the endpoint policy and the tools, not here.
 *
 * Concurrency: driveLoop calls for different agents are independent, so
 * `Promise.all(agents.map(driveLoop))` runs the whole team at the same time,
 * with the shared store (via tools) as their coordination point.
 */
export interface DriveOptions {
  maxSteps?: number;
  onEvent?: (agentName: string, event: string) => void;
}

export async function driveLoop(
  mod: AgentModule,
  agent: Agent,
  goal: string,
  options: DriveOptions = {},
): Promise<string> {
  const maxSteps = options.maxSteps ?? 40;
  const log = (event: string) => options.onEvent?.(agent.name, event);
  const loop = await mod.createLoop({ agentId: agent.id, goal });

  const context: ContextItem[] = [
    { type: "developer_message", text: agent.instruction },
    { type: "user_message", text: goal },
  ];

  for (let step = 0; step < maxSteps; step++) {
    await mod.setBreakpoint({
      loopId: loop.id,
      instruction: {
        type: "inference",
        parameters: {
          model: LOCAL_MODEL_NAME,
          context: { items: [...context] },
          tools: agent.tools,
        },
      },
    });
    await mod.advanceLoop({ loopId: loop.id });

    let rec = await mod.getLoop(loop.id);
    const inference = rec.completedInstructions[rec.completedInstructions.length - 1];
    if (inference?.type !== "inference" || inference.result?.type !== "inference_output") {
      throw new Error(`${agent.name}: unexpected inference record at step ${step}`);
    }
    const items = inference.result.items;
    context.push(...items);

    const call = items.find((i) => i.type === "tool_call");
    if (!call) {
      const message = items.find((i) => i.type === "model_message")?.text ?? "";
      await mod.endLoop({ loopId: loop.id, message });
      log(`finished: ${message}`);
      return message;
    }

    log(`tool call: ${call.toolName}`);
    await mod.setBreakpoint({
      loopId: loop.id,
      instruction: {
        type: "tool_call",
        parameters: { toolName: call.toolName, toolArguments: call.toolArguments },
      },
    });
    await mod.advanceLoop({ loopId: loop.id });

    rec = await mod.getLoop(loop.id);
    const toolRec = rec.completedInstructions[rec.completedInstructions.length - 1];
    if (toolRec?.type !== "tool_call" || !toolRec.result) {
      throw new Error(`${agent.name}: unexpected tool record at step ${step}`);
    }
    context.push({
      type: "tool_call_result",
      requestId: call.requestId,
      result: { type: "input_text", text: toolRec.result.result },
    });
  }

  await mod.endLoop({ loopId: loop.id, message: "step budget exhausted" });
  throw new Error(`${agent.name}: exceeded ${maxSteps} steps`);
}
