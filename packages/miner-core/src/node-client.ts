/**
 * The most requests one JSON-RPC call to a node may carry. The SDK's client batches every request
 * issued in one event-loop turn (up to 100 per call), and dRPC's free plan, the default V6 node,
 * refuses any batch above 3 ("Batch of more than 3 requests are not allowed on free plan").
 */
export const NODE_MAX_BATCH = 3;
