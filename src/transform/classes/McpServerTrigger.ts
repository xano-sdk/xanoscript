/** Port of redacted. */
import type { KindNode } from "../transform.js";
import { encodeAgentTrigger } from "./AgentTrigger.js";

export const KIND = "schema:mcp_server_trigger";

/**
 * PHP: `class McpServerTrigger extends AgentTrigger` overriding the kind, the
 * name label, and `hasPrimitives()` (true: its input gains `prompts` and
 * `resources`), and appending the signed-in user as `json ?auth` after the
 * other inputs.
 */
export function McpServerTrigger(data: Record<string, unknown>): KindNode {
  const ret = encodeAgentTrigger(data, KIND, "mcp_server", true);

  for (const block of ret.blocks as KindNode[]) {
    if ((block.kind ?? "") !== "schema:input") continue;

    (block.blocks as KindNode[]).push({
      kind: "schema:json",
      args: [
        { name: "name", kind: "static:text", value: "auth" },
        { name: "nullable", kind: "static:bool", value: true },
      ],
      blocks: [],
    });
    break;
  }

  return ret;
}
