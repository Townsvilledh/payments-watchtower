/** Name of the local deterministic model the agents run on by default.
 *  Registered in src/local-model.ts. Running keyless is deliberate: judges can
 *  run the demo with no accounts and no API keys, and every agent decision is
 *  reproducible from the seeded synthetic data. */
export const LOCAL_MODEL_NAME = "watchtower-local-1";

/** Seed for the synthetic Black Friday transaction stream, so runs are
 *  reproducible and every reported number can be checked against its source
 *  transaction. */
export const STREAM_SEED = 20261127;

/** How many synthetic transactions one demo run processes. */
export const STREAM_SIZE = 60;
