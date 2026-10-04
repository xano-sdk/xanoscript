/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:trigger.call";

export function TriggerCall(data: Record<string, unknown>): KindNode {
  let triggerName: string;
  try {
    triggerName = script().mapIdToTriggerName(mapperGet("context.id", data));
  } catch {
    triggerName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", triggerName)], blocks: [] };

  if (!phpEmpty(data.input)) (ret.blocks as KindNode[]).push(Transform.inputsToObjectBlock(data.input));

  return ret;
}
