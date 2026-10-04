/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:function.call";

export function FunctionCall(data: Record<string, unknown>): KindNode {
  let functionName: string;
  try {
    functionName = script().mapIdToFunctionName(mapperGet("context.id", data));
  } catch {
    functionName = "";
  }
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", functionName)], blocks: [] };
  if (!phpEmpty(data.input)) (ret.blocks as KindNode[]).push(Transform.convertFlexInputToBlock(data.input));
  return ret;
}
