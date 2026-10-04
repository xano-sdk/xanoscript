/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:ai.agent.run";

export function AgentRun(data: Record<string, unknown>): KindNode {
  const toolsetId = mapperGet("context.toolset.id", data);

  let toolName: string;
  try {
    toolName = script().mapIdToToolsetName(toolsetId);
  } catch {
    toolName = "";
  }

  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", toolName), Transform.inlineAssign("as", data.as ?? "")],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  const runtimeMode = mapperGet("runtime.mode", data) ?? "disabled";
  if (runtimeMode !== "disabled") blocks.push(Transform.inlineAssign("runtime_mode", runtimeMode));

  // `input` arrives keyed by name (convertStackItemImpl ran migrateInput).
  const input = (data.input ?? {}) as Record<string, unknown>;
  blocks.push(Transform.convertAssignmentValue(input.args ?? [], "args"));
  blocks.push(Transform.convertAssignmentValue(input.allow_tool_execution ?? false, "allow_tool_execution"));

  if (!phpEmpty(input.version)) blocks.push(Transform.convertAssignmentValue(input.version, "version"));

  return ret;
}
