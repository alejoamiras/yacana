/**
 * dRPC's free plan, the default V6 node, refuses a JSON-RPC batch above 3; the SDK batches each
 * event-loop turn's requests, up to 100.
 */
export const NODE_MAX_BATCH = 3;
