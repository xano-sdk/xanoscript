/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:tool.call";

export function ToolCall(data: Record<string, unknown>): KindNode {
  let toolName: string;
  try {
    toolName = script().mapIdToToolName(mapperGet("context.id", data));
  } catch {
    toolName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", toolName)], blocks: [] };

  if (!phpEmpty(data.input)) (ret.blocks as KindNode[]).push(Transform.inputsToObjectBlock(data.input));

  return ret;
}
