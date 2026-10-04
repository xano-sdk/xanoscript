/** Port of redacted. */
import type { KindNode } from "../transform.js";
import { encodeAgentTrigger } from "./AgentTrigger.js";

export const KIND = "schema:mcp_server_trigger";

/**
 * PHP: `class McpServerTrigger extends AgentTrigger` overriding only the kind,
 * the name label, and `hasPrimitives()` (true: its input gains `prompts` and
 * `resources`).
 */
export function McpServerTrigger(data: Record<string, unknown>): KindNode {
  return encodeAgentTrigger(data, KIND, "mcp_server", true);
}
