import {
  type Endpoint,
  type GenerativeModel,
  type InferenceParams,
  type InferenceResult,
  type SemanticEvent,
} from "@mozaik-ai/core";
import { LOCAL_MODEL_NAME } from "./config.js";

/**
 * The local deterministic endpoint the Watchtower agents reason through.
 *
 * Mozaik picks a model by name from the models registered in
 * `initAgentModule({ inferenceRunnerConfig: { supportedModels } })`, so
 * registering this model makes every agent runnable with no API key. The
 * endpoint inspects the agent's context (its instruction, the goal, and the
 * tool results so far) and decides the next step: call a tool, or finish
 * with a message.
 *
 * SCAFFOLD STATE: the dispatch skeleton is wired, but the per-agent decision
 * policy is the core of the hackathon build and is implemented during the
 * event window — see BUILD_PLAN.md, step 3. The pattern itself is proven in
 * spikes/loop-driver.ts against this exact package version.
 */
export class LocalFinanceEndpoint implements Endpoint {
  async infer(_params: InferenceParams): Promise<InferenceResult> {
    throw new Error(
      "LocalFinanceEndpoint.infer: decision policy is implemented during the " +
        "hackathon build window (BUILD_PLAN.md step 3).",
    );
  }

  async *stream(_params: InferenceParams): AsyncIterable<SemanticEvent> {
    throw new Error(
      "LocalFinanceEndpoint.stream: not used by the Watchtower driver.",
    );
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
